"""Glue between HTTP, the database and the agent workflows: persistence, proposals, apply/reject, chat."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..agent.graph import run_workflow
from ..agent.llm import LLMError, get_llm
from ..agent.llm_planner import llm_answer, llm_route
from ..agent.router import RouterResult, answer_question, parse_message
from ..agent.tool_client import get_tools
from ..models import AgentRun, ChangeEvent, ChatMessage, ItineraryVersion, Trip, User
from ..schemas import (
    Change,
    ChangeRequest,
    ChatReply,
    Diff,
    Itinerary,
    Proposal,
    TripRequest,
    Violation,
)
from ..services import memory
from ..services.editor import find_item

# ----------------------------------------------------------------------------- helpers


def trip_request(trip: Trip) -> TripRequest:
    return TripRequest.model_validate(trip.request)


def closed_ids(trip: Trip) -> list[str]:
    return list(trip.request.get("_closed", []))


def get_version(db: Session, trip_id: str, version_id: str) -> ItineraryVersion | None:
    v = db.get(ItineraryVersion, version_id)
    return v if v and v.trip_id == trip_id else None


def current_version(db: Session, trip: Trip) -> ItineraryVersion | None:
    return db.get(ItineraryVersion, trip.current_version_id) if trip.current_version_id else None


def current_itinerary(db: Session, trip: Trip) -> Itinerary | None:
    v = current_version(db, trip)
    return Itinerary.model_validate(v.itinerary) if v else None


def next_version_no(db: Session, trip_id: str) -> int:
    return (db.scalar(select(func.max(ItineraryVersion.version_no)).where(ItineraryVersion.trip_id == trip_id)) or 0) + 1


def user_context(db: Session, user: User, req: TripRequest) -> tuple[dict, list[str]]:
    prefs = memory.get_prefs(db, user.id)
    weights = dict(prefs.category_weights or {})
    mems = memory.retrieve_memories(db, user.id, f"{req.destination} {' '.join(req.interests)} {req.pace}")
    return weights, [m.content for m in mems]


def record_run(db: Session, metrics: dict, *, trip_id: str | None, user_id: str, status: str = "ok", error: str | None = None) -> None:
    db.add(AgentRun(
        trip_id=trip_id, user_id=user_id, workflow=metrics.get("workflow", "?"), planner=metrics.get("planner", "heuristic"),
        models=metrics.get("models", []), input_tokens=metrics.get("input_tokens", 0), output_tokens=metrics.get("output_tokens", 0),
        cost_usd=metrics.get("cost_usd", 0.0), latency_ms=metrics.get("latency_ms", 0), tool_calls=metrics.get("tool_calls", 0),
        tool_errors=metrics.get("tool_errors", 0), cache_hits=metrics.get("cache_hits", 0),
        repair_loops=metrics.get("repair_loops", 0), node_timings=metrics.get("node_timings_ms", {}), status=status, error=error,
    ))


def sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


# ----------------------------------------------------------------------------- create


async def create_trip_stream(db: Session, user: User, req: TripRequest) -> AsyncIterator[str]:
    weights, memories = user_context(db, user, req)
    try:
        result = None
        async for ev in run_workflow({"mode": "create", "request": req, "weights": weights, "memories": memories},
                                     "create", {"user_id": user.id}):
            if ev["type"] == "result":
                result = ev
            else:
                yield sse(ev)
        assert result is not None and result["state"]
        st, metrics = result["state"], result["metrics"]
        itin: Itinerary = st["draft"]
        ctx = st["ctx"]
        trip = Trip(user_id=user.id, destination=itin.destination, lat=ctx.base[0], lng=ctx.base[1],
                    start_date=req.start_date, end_date=req.end_date, budget_inr=req.budget_inr,
                    request=st["request"].model_dump(mode="json"))
        db.add(trip)
        db.flush()
        v = ItineraryVersion(
            trip_id=trip.id, version_no=1, itinerary=itin.model_dump(mode="json"), change_reason="Initial itinerary",
            change_type="create", status="applied", violations=[x.model_dump() for x in st.get("violations", [])],
            metrics={**metrics, "stats": st.get("stats", {})},
        )
        db.add(v)
        db.flush()
        trip.current_version_id = v.id
        record_run(db, metrics, trip_id=trip.id, user_id=user.id)
        db.commit()
        yield sse({"type": "itinerary", "trip_id": trip.id, "version_id": v.id, "itinerary": itin.model_dump(mode="json"),
                   "notes": st.get("notes", []), "metrics": metrics, "stats": st.get("stats", {})})
    except Exception as exc:  # surfaced to the UI as an error event rather than a dropped connection
        db.rollback()
        code = getattr(exc, "error_code", "internal_error")
        message = getattr(exc, "message", None) or str(exc)
        record_run(db, {"workflow": "create"}, trip_id=None, user_id=user.id, status="error", error=message[:500])
        db.commit()
        yield sse({"type": "error", "code": code, "message": message})


# ----------------------------------------------------------------------------- change proposals


async def propose_change(
    db: Session, trip: Trip, user: User, cr: ChangeRequest, *, change_type: str, reason: str, event: ChangeEvent | None = None,
) -> Proposal | None:
    base = current_itinerary(db, trip)
    assert base is not None
    req = trip_request(trip)
    weights, _ = user_context(db, user, req)
    result = None
    async for ev in run_workflow({"mode": "change", "request": req, "base": base, "change": cr, "weights": weights,
                                  "closed": closed_ids(trip)}, change_type, {"user_id": user.id, "trip_id": trip.id}):
        if ev["type"] == "result":
            result = ev
    assert result is not None and result["state"]
    st, metrics = result["state"], result["metrics"]
    draft: Itinerary = st["draft"]
    diff: Diff = st["diff"]
    record_run(db, metrics, trip_id=trip.id, user_id=user.id)
    if not diff.changes:
        db.commit()
        return Proposal(change_type=change_type, reason=reason, diff=diff, itinerary=draft, notes=st.get("notes", []),
                        violations=st.get("violations", []), affected=st.get("affected", []))
    v = ItineraryVersion(
        trip_id=trip.id, version_no=next_version_no(db, trip.id), parent_version_id=trip.current_version_id,
        itinerary=draft.model_dump(mode="json"), change_reason=reason, change_type=change_type, status="proposed",
        diff=diff.model_dump(mode="json"), affected=[a.model_dump() for a in st.get("affected", [])],
        violations=[x.model_dump() for x in st.get("violations", [])],
        metrics={**metrics, "request_patch": st.get("request_patch", {}), "notes": st.get("notes", []),
                 "stats": st.get("stats", {})},
    )
    db.add(v)
    db.flush()
    if event is not None:
        event.proposed_version_id = v.id
        event.affected_item_ids = [a.item_id for a in st.get("affected", [])]
    db.commit()
    return Proposal(version_id=v.id, change_type=change_type, reason=reason, diff=diff, itinerary=draft,
                    affected=st.get("affected", []), violations=[Violation.model_validate(x) for x in v.violations or []],
                    notes=st.get("notes", []))


def apply_version(db: Session, trip: Trip, version: ItineraryVersion, user: User) -> None:
    """Promote a proposed version: update the trip, learn from what the user changed, resolve events."""
    patch = (version.metrics or {}).get("request_patch", {})
    req = dict(trip.request)
    for k, val in patch.items():
        req[k] = val
    if "budget_inr" in patch:
        trip.budget_inr = int(patch["budget_inr"])
    trip.request = req
    trip.current_version_id = version.id
    version.status = "applied"
    for other in db.scalars(select(ItineraryVersion).where(
            ItineraryVersion.trip_id == trip.id, ItineraryVersion.status == "proposed", ItineraryVersion.id != version.id)).all():
        if other.parent_version_id == version.parent_version_id:
            other.status = "rejected"  # competing proposals against the same parent are now stale
    for ev in db.scalars(select(ChangeEvent).where(ChangeEvent.trip_id == trip.id, ChangeEvent.proposed_version_id == version.id)).all():
        ev.status = "resolved"
    # learn: stops the user explicitly removed or swapped away are a negative signal
    if version.change_type in ("edit", "whatif") and version.diff:
        parent = db.get(ItineraryVersion, version.parent_version_id) if version.parent_version_id else None
        if parent:
            old = Itinerary.model_validate(parent.itinerary)
            explicit = {a["item_id"] for a in (version.affected or []) if str(a.get("reason", "")).startswith("You ")}
            for ch in version.diff.get("changes", []):
                if ch["kind"] != "removed":
                    continue
                for _, it in old.all_items():
                    if it.place_id == ch["place_id"] and it.id in explicit:
                        memory.apply_feedback(db, user.id, trip.id, item_id=it.id, place_id=it.place_id,
                                              category=it.category, tags=it.tags, signal="removed")
    db.commit()


def reject_version(db: Session, trip: Trip, version: ItineraryVersion) -> None:
    version.status = "rejected"
    for ev in db.scalars(select(ChangeEvent).where(ChangeEvent.trip_id == trip.id, ChangeEvent.proposed_version_id == version.id)).all():
        ev.status = "dismissed"
    db.commit()


# ----------------------------------------------------------------------------- chat


async def handle_chat(db: Session, trip: Trip, user: User, message: str, *, force_whatif: bool = False) -> ChatReply:
    base = current_itinerary(db, trip)
    assert base is not None
    req = trip_request(trip)
    db.add(ChatMessage(trip_id=trip.id, role="user", content=message))
    llm = get_llm()
    routed: RouterResult | None = None
    if llm.enabled:
        try:
            routed = await llm_route(llm, message, base, trip.budget_inr)
        except LLMError:
            routed = None
    if routed is None or (routed.intent == "chitchat" and not llm.enabled):
        routed = parse_message(message, base, trip.budget_inr, req.pace)
    elif routed.intent == "chitchat":  # let the rule parser have a go before giving up
        fallback = parse_message(message, base, trip.budget_inr, req.pace)
        if fallback.intent != "chitchat":
            routed = fallback
    if force_whatif and routed.intent in ("edit", "constraint_change"):
        routed.intent = "whatif"

    reply = await _respond(db, trip, user, routed, message, base)
    db.add(ChatMessage(
        trip_id=trip.id, role="assistant", content=reply.reply,
        payload={"intent": reply.intent, "version_id": reply.proposal.version_id if reply.proposal else None,
                 "diff_summary": reply.proposal.diff.summary if reply.proposal else None, "citations": reply.citations},
    ))
    db.commit()
    return reply


async def _respond(db: Session, trip: Trip, user: User, routed: RouterResult, message: str, base: Itinerary) -> ChatReply:
    if routed.intent == "chitchat":
        return ChatReply(intent="chitchat", reply=routed.message or "Tell me what you would like to change.")
    if routed.intent == "question":
        guides = []
        try:
            guides = await get_tools().guides(trip.destination, message, 3)
        except Exception:
            pass
        text, cites = (None, [])
        if get_llm().enabled:
            try:
                text, cites = await llm_answer(get_llm(), message, base, guides)
            except LLMError:
                text = None
        if text is None:
            text, cites = answer_question(message, base, guides)
        return ChatReply(intent="question", reply=text, citations=cites)

    cr = routed.request
    # a concrete "make it cheaper" without a figure is relative to the current budget
    for c in cr.changes:
        if c.kind == "budget_delta" and c.amount_inr is None:
            c.amount_inr = -int(trip.budget_inr * 0.15)
    label = "whatif" if routed.intent == "whatif" else "edit"
    proposal = await propose_change(db, trip, user, cr, change_type=label, reason=message)
    if proposal is None or not proposal.diff.changes:
        notes = " ".join(proposal.notes) if proposal else ""
        return ChatReply(intent=routed.intent, reply=(notes or "That would not change anything in the current plan."), proposal=proposal)  # type: ignore[arg-type]
    lead = "Here is what that would look like" if routed.intent == "whatif" else "Here is the proposed change"
    summary = f"{lead}: {proposal.diff.summary}."
    if proposal.notes:
        summary += " " + " ".join(proposal.notes)
    return ChatReply(intent=routed.intent, reply=summary, proposal=proposal)  # type: ignore[arg-type]


# ----------------------------------------------------------------------------- events (weather / availability)


async def simulate_event(db: Session, trip: Trip, user: User, kind: str, day: int | None, item_id: str | None) -> Proposal | None:
    base = current_itinerary(db, trip)
    assert base is not None
    if kind == "weather":
        cr = ChangeRequest(changes=[Change(kind="weather", day=day if day is not None else 0)])
        payload = {"day": day if day is not None else 0, "simulated": True}
        etype, reason = "weather", f"Simulated heavy rain on day {(day or 0) + 1}"
    else:
        hit = find_item(base, item_id or "")
        if not hit:
            raise ValueError("Unknown stop")
        _, it = hit
        cr = ChangeRequest(changes=[Change(kind="closure", item_id=it.id, place_name=it.name)])
        payload = {"place_id": it.place_id, "name": it.name, "simulated": True}
        etype, reason = "availability", f"{it.name} was marked closed or sold out"
    ev = ChangeEvent(trip_id=trip.id, type=etype, payload=payload, status="open",
                     idempotency_key=f"{etype}:{trip.id}:{json.dumps(payload, sort_keys=True)}")
    db.add(ev)
    db.flush()
    proposal = await propose_change(db, trip, user, cr, change_type="replan", reason=reason, event=ev)
    if proposal is None or not proposal.diff.changes:
        ev.status = "dismissed"
        db.commit()
    return proposal


def today() -> date:
    return date.today()
