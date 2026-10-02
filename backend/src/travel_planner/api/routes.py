"""HTTP API. Thin: validation, auth, persistence and calls into services/orchestrator."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..cache import get_cache
from ..config import get_settings
from ..db import get_session
from ..models import (
    AgentRun,
    ChangeEvent,
    ChatMessage,
    Feedback,
    ItineraryVersion,
    Trip,
    User,
    UserPreference,
)
from ..schemas import INTERESTS, Itinerary, TripRequest
from ..services import memory
from ..services import orchestrator as orch
from ..tools.core import data_mode
from ..tools.demo_data import DESTINATIONS
from .security import CurrentUser, enforce_quota, hash_password, make_token, verify_password

router = APIRouter(prefix="/api")
DB = Annotated[Session, Depends(get_session)]


# ----------------------------------------------------------------------------- meta & auth


@router.get("/meta")
def meta() -> dict:
    s = get_settings()
    return {
        "data_mode": data_mode(), "llm_mode": "openai" if s.llm_enabled else "built-in planner",
        "models": {"plan": s.openai_model_plan, "fast": s.openai_model_fast} if s.llm_enabled else None,
        "tools_mode": s.tools_mode, "cache": get_cache().backend, "langfuse": s.langfuse_enabled,
        "interests": INTERESTS,
        "destinations": [m["name"] for m in DESTINATIONS.values()] if not s.google_enabled else None,
        "rain_threshold": s.rain_threshold_pct,
    }


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(default="", max_length=120)


def _user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name}


@router.post("/auth/register")
def register(body: Credentials, db: DB) -> dict:
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    user = User(email=email, name=body.name.strip() or email.split("@")[0], password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    memory.get_prefs(db, user.id)
    db.commit()
    return {"token": make_token(user.id), "user": _user_out(user)}


class Login(BaseModel):
    email: EmailStr
    password: str


@router.post("/auth/login")
def login(body: Login, db: DB) -> dict:
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect")
    return {"token": make_token(user.id), "user": _user_out(user)}


@router.get("/me")
def me(user: CurrentUser) -> dict:
    return _user_out(user)


# ----------------------------------------------------------------------------- trips


def _own_trip(db: Session, user: User, trip_id: str) -> Trip:
    trip = db.get(Trip, trip_id)
    if not trip or trip.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    return trip


def _version_summary(v: ItineraryVersion) -> dict:
    return {
        "id": v.id, "version_no": v.version_no, "change_type": v.change_type, "status": v.status, "reason": v.change_reason,
        "created_at": v.created_at, "diff": v.diff, "affected": v.affected,
        "notes": (v.metrics or {}).get("notes", []),
    }


@router.get("/trips")
def list_trips(db: DB, user: CurrentUser) -> list[dict]:
    trips = db.scalars(select(Trip).where(Trip.user_id == user.id).order_by(Trip.created_at.desc())).all()
    out = []
    for t in trips:
        v = orch.current_version(db, t)
        it = Itinerary.model_validate(v.itinerary) if v else None
        out.append({
            "id": t.id, "destination": t.destination, "start_date": t.start_date, "end_date": t.end_date,
            "budget_inr": t.budget_inr, "cost_inr": it.totals.cost_inr if it else 0, "stops": it.totals.items if it else 0,
            "interests": t.request.get("interests", []), "created_at": t.created_at,
            "open_events": db.scalar(select(func.count()).select_from(ChangeEvent).where(
                ChangeEvent.trip_id == t.id, ChangeEvent.status == "open")) or 0,
        })
    return out


@router.post("/trips/stream")
async def create_trip(req: TripRequest, db: DB, user: CurrentUser) -> StreamingResponse:
    if req.end_date < req.start_date or req.num_days > 10:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose 1 to 10 days with the end date after the start date")
    enforce_quota(user)
    return StreamingResponse(orch.create_trip_stream(db, user, req), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/trips/{trip_id}")
def get_trip(trip_id: str, db: DB, user: CurrentUser) -> dict:
    trip = _own_trip(db, user, trip_id)
    cur = orch.current_version(db, trip)
    proposals = db.scalars(select(ItineraryVersion).where(
        ItineraryVersion.trip_id == trip.id, ItineraryVersion.status == "proposed",
        ItineraryVersion.parent_version_id == trip.current_version_id).order_by(ItineraryVersion.created_at.desc())).all()
    events = db.scalars(select(ChangeEvent).where(ChangeEvent.trip_id == trip.id).order_by(ChangeEvent.created_at.desc()).limit(10)).all()
    msgs = db.scalars(select(ChatMessage).where(ChatMessage.trip_id == trip.id).order_by(ChatMessage.created_at)).all()
    last_run = db.scalars(select(AgentRun).where(AgentRun.trip_id == trip.id).order_by(AgentRun.created_at.desc())).first()
    return {
        "trip": {"id": trip.id, "destination": trip.destination, "lat": trip.lat, "lng": trip.lng,
                 "start_date": trip.start_date, "end_date": trip.end_date, "budget_inr": trip.budget_inr, "request": trip.request},
        "version": {"id": cur.id, "version_no": cur.version_no, "metrics": cur.metrics} if cur else None,
        "itinerary": cur.itinerary if cur else None,
        "proposals": [_version_summary(p) for p in proposals],
        "events": [{"id": e.id, "type": e.type, "payload": e.payload, "status": e.status, "proposed_version_id": e.proposed_version_id,
                    "affected_item_ids": e.affected_item_ids, "created_at": e.created_at} for e in events],
        "messages": [{"id": m.id, "role": m.role, "content": m.content, "payload": m.payload, "created_at": m.created_at} for m in msgs],
        "last_run": {"workflow": last_run.workflow, "latency_ms": last_run.latency_ms, "input_tokens": last_run.input_tokens,
                     "output_tokens": last_run.output_tokens, "cost_usd": last_run.cost_usd, "tool_calls": last_run.tool_calls,
                     "planner": last_run.planner, "repair_loops": last_run.repair_loops} if last_run else None,
    }


@router.delete("/trips/{trip_id}", status_code=204)
def delete_trip(trip_id: str, db: DB, user: CurrentUser) -> None:
    trip = _own_trip(db, user, trip_id)
    db.delete(trip)
    db.commit()


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=600)


@router.post("/trips/{trip_id}/chat")
async def chat(trip_id: str, body: ChatIn, db: DB, user: CurrentUser) -> dict:
    trip = _own_trip(db, user, trip_id)
    enforce_quota(user)
    reply = await orch.handle_chat(db, trip, user, body.message)
    return reply.model_dump(mode="json")


class WhatIfIn(BaseModel):
    scenario: str = Field(min_length=1, max_length=400)


@router.post("/trips/{trip_id}/whatif")
async def whatif(trip_id: str, body: WhatIfIn, db: DB, user: CurrentUser) -> dict:
    trip = _own_trip(db, user, trip_id)
    enforce_quota(user)
    reply = await orch.handle_chat(db, trip, user, body.scenario, force_whatif=True)
    return reply.model_dump(mode="json")


class SimulateIn(BaseModel):
    type: Literal["weather", "closure"]
    day: int | None = Field(default=None, ge=0, le=20)
    item_id: str | None = None


@router.post("/trips/{trip_id}/events/simulate")
async def simulate(trip_id: str, body: SimulateIn, db: DB, user: CurrentUser) -> dict:
    trip = _own_trip(db, user, trip_id)
    enforce_quota(user)
    try:
        proposal = await orch.simulate_event(db, trip, user, body.type, body.day, body.item_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return {"proposal": proposal.model_dump(mode="json") if proposal else None}


@router.get("/trips/{trip_id}/versions")
def versions(trip_id: str, db: DB, user: CurrentUser) -> list[dict]:
    trip = _own_trip(db, user, trip_id)
    rows = db.scalars(select(ItineraryVersion).where(ItineraryVersion.trip_id == trip.id).order_by(ItineraryVersion.version_no.desc())).all()
    return [{**_version_summary(v), "current": v.id == trip.current_version_id} for v in rows if v.status != "rejected"]


@router.get("/trips/{trip_id}/versions/{version_id}")
def version_detail(trip_id: str, version_id: str, db: DB, user: CurrentUser) -> dict:
    trip = _own_trip(db, user, trip_id)
    v = orch.get_version(db, trip.id, version_id)
    if not v:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    return {**_version_summary(v), "itinerary": v.itinerary, "violations": v.violations}


@router.post("/trips/{trip_id}/versions/{version_id}/apply")
def apply(trip_id: str, version_id: str, db: DB, user: CurrentUser) -> dict:
    trip = _own_trip(db, user, trip_id)
    v = orch.get_version(db, trip.id, version_id)
    if not v or v.status == "rejected":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    orch.apply_version(db, trip, v, user)
    return {"ok": True, "version_id": v.id}


@router.post("/trips/{trip_id}/versions/{version_id}/reject")
def reject(trip_id: str, version_id: str, db: DB, user: CurrentUser) -> dict:
    trip = _own_trip(db, user, trip_id)
    v = orch.get_version(db, trip.id, version_id)
    if not v or v.status != "proposed":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposal not found")
    orch.reject_version(db, trip, v)
    return {"ok": True}


class FeedbackIn(BaseModel):
    item_id: str
    signal: Literal["up", "down", "kept"]


@router.post("/trips/{trip_id}/feedback")
def feedback(trip_id: str, body: FeedbackIn, db: DB, user: CurrentUser) -> dict:
    from ..services.editor import find_item

    trip = _own_trip(db, user, trip_id)
    itin = orch.current_itinerary(db, trip)
    hit = find_item(itin, body.item_id) if itin else None
    if not hit:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stop not found")
    _, it = hit
    out = memory.apply_feedback(db, user.id, trip.id, item_id=it.id, place_id=it.place_id, category=it.category,
                                tags=it.tags, signal=body.signal)
    db.commit()
    return out


class LockIn(BaseModel):
    locked: bool


@router.post("/trips/{trip_id}/items/{item_id}/lock")
def lock_item(trip_id: str, item_id: str, body: LockIn, db: DB, user: CurrentUser) -> dict:
    trip = _own_trip(db, user, trip_id)
    cur = orch.current_version(db, trip)
    if not cur:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No itinerary")
    itin = Itinerary.model_validate(cur.itinerary)
    hit = next((it for _, it in itin.all_items() if it.id == item_id), None)
    if not hit:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stop not found")
    hit.locked = body.locked
    cur.itinerary = itin.model_dump(mode="json")
    db.commit()
    return {"ok": True, "locked": hit.locked}


# ----------------------------------------------------------------------------- preferences, memory, runs


class PrefsIn(BaseModel):
    pace: Literal["relaxed", "balanced", "packed"] = "balanced"
    travel_style: Literal["budget", "balanced", "luxury"] = "balanced"
    diet: Literal["none", "vegetarian", "vegan"] = "none"
    step_free: bool = False
    interests: list[str] = Field(default_factory=list, max_length=10)
    avoid: list[str] = Field(default_factory=list, max_length=10)


def _prefs_out(p: UserPreference) -> dict:
    return {"pace": p.pace, "travel_style": p.travel_style, "diet": p.diet, "step_free": p.step_free,
            "interests": p.interests or [], "avoid": p.avoid or [], "category_weights": p.category_weights or {}}


@router.get("/preferences")
def get_preferences(db: DB, user: CurrentUser) -> dict:
    p = memory.get_prefs(db, user.id)
    db.commit()
    return _prefs_out(p)


@router.put("/preferences")
def put_preferences(body: PrefsIn, db: DB, user: CurrentUser) -> dict:
    p = memory.get_prefs(db, user.id)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    return _prefs_out(p)


class MemoryIn(BaseModel):
    content: str = Field(min_length=3, max_length=200)


def _mem_out(m) -> dict:  # noqa: ANN001
    return {"id": m.id, "content": m.content, "kind": m.kind, "confidence": m.confidence, "evidence": m.evidence,
            "created_at": m.created_at}


@router.get("/memories")
def memories(db: DB, user: CurrentUser) -> list[dict]:
    return [_mem_out(m) for m in memory.list_memories(db, user.id)]


@router.post("/memories")
def add_memory(body: MemoryIn, db: DB, user: CurrentUser) -> dict:
    m = memory.add_memory(db, user.id, body.content.strip(), kind="explicit", confidence=1.0, evidence="You told me this")
    db.commit()
    return _mem_out(m)


@router.delete("/memories/{memory_id}", status_code=204)
def remove_memory(memory_id: str, db: DB, user: CurrentUser) -> None:
    if not memory.delete_memory(db, user.id, memory_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Memory not found")
    db.commit()


@router.get("/runs/summary")
def runs_summary(db: DB, user: CurrentUser) -> dict:
    rows = db.scalars(select(AgentRun).where(AgentRun.user_id == user.id).order_by(AgentRun.created_at.desc()).limit(200)).all()
    if not rows:
        return {"runs": 0}
    lat = sorted(r.latency_ms for r in rows)

    def pct(p: float) -> int:
        return lat[min(len(lat) - 1, int(len(lat) * p))]

    return {
        "runs": len(rows), "p50_ms": pct(0.5), "p95_ms": pct(0.95), "tokens": sum(r.input_tokens + r.output_tokens for r in rows),
        "cost_usd": round(sum(r.cost_usd for r in rows), 4), "tool_calls": sum(r.tool_calls for r in rows),
        "tool_errors": sum(r.tool_errors for r in rows), "repair_loops": sum(r.repair_loops for r in rows),
        "errors": sum(1 for r in rows if r.status != "ok"),
        "feedback_events": db.scalar(select(func.count()).select_from(Feedback).where(Feedback.user_id == user.id)) or 0,
    }
