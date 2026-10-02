"""Glue between HTTP, the database and the agent workflows: persistence, proposals, apply/reject, chat."""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..agent.graph import run_workflow
from ..agent.llm import LLMError, get_llm
from ..agent.llm_planner import llm_answer
from ..agent.router import RouterResult, answer_question, complete_pending, parse_message
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
from ..services.diff import diff_itineraries
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
            metrics={**metrics, "stats": st.get("stats", {}), "request_snapshot": dict(trip.request)},
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
    return store_proposal(db, trip, user, result["state"], result["metrics"], change_type=change_type, reason=reason,
                          event=event)


def store_proposal(db: Session, trip: Trip, user: User, st: dict, metrics: dict, *, change_type: str, reason: str,
                   event: ChangeEvent | None = None, extra_metrics: dict | None = None) -> Proposal:
    """Persist a workflow result as a proposed version (unless nothing changed) and record the run."""
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
                 "stats": st.get("stats", {}), **(extra_metrics or {})},
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


async def revert_to(db: Session, trip: Trip, target: ItineraryVersion, *, reason: str) -> Proposal | None:
    """Propose going back to an earlier version: its stops, and its trip settings when they were saved with it."""
    base = current_itinerary(db, trip)
    assert base is not None
    if target.id == trip.current_version_id:
        return None
    restored = Itinerary.model_validate(target.itinerary)
    diff = diff_itineraries(base, restored, [])
    snapshot = (target.metrics or {}).get("request_snapshot")
    notes = [] if snapshot else ["That version was saved before trip settings were kept with it, so only the stops come back; "
                                 "budget and preferences stay as they are now."]
    if not diff.changes and (not snapshot or snapshot == trip.request):
        return None
    v = ItineraryVersion(
        trip_id=trip.id, version_no=next_version_no(db, trip.id), parent_version_id=trip.current_version_id,
        itinerary=target.itinerary, change_reason=reason, change_type="revert", status="proposed",
        diff=diff.model_dump(mode="json"), affected=[], violations=list(target.violations or []),
        metrics={"request_restore": snapshot, "notes": notes, "restored_from": target.id},
    )
    db.add(v)
    db.commit()
    return Proposal(version_id=v.id, change_type="revert", reason=reason, diff=diff, itinerary=restored, notes=notes,
                    violations=[Violation.model_validate(x) for x in v.violations or []])


def pending_proposal(db: Session, trip: Trip) -> ItineraryVersion | None:
    return db.scalars(select(ItineraryVersion).where(
        ItineraryVersion.trip_id == trip.id, ItineraryVersion.status == "proposed",
        ItineraryVersion.parent_version_id == trip.current_version_id).order_by(ItineraryVersion.created_at.desc())).first()


def apply_version(db: Session, trip: Trip, version: ItineraryVersion, user: User) -> None:
    """Promote a proposed version: update the trip, learn from what the user changed, resolve events."""
    metrics = version.metrics or {}
    patch = metrics.get("request_patch", {})
    req = dict(metrics["request_restore"]) if metrics.get("request_restore") else dict(trip.request)
    for k, val in patch.items():
        req[k] = val
    if "budget_inr" in req:
        trip.budget_inr = int(req["budget_inr"])
    trip.request = req
    version.metrics = {**metrics, "request_snapshot": dict(req)}  # so this version can be restored later
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


CONFIRM = re.compile(r"^(?:yes|yep|yeah|yup|sure|ok(?:ay)?|apply(?: it| that| the change)?|accept(?: it)?|looks good|"
                     r"sounds good|do it|go ahead|confirm|perfect|great|that works|lgtm|yes please)[.! ]*(?:please|thanks)?[.! ]*$", re.I)
REJECT = re.compile(r"^(?:no|nope|nah|discard(?: it| that)?|reject(?: it| that)?|cancel(?: it| that)?|never ?mind|"
                    r"don'?t apply(?: it)?|scrap (?:it|that)|forget it|leave it)[.! ]*(?:thanks)?[.! ]*$", re.I)
UNDO = re.compile(r"^(?:please\s+)?(?:undo|revert|roll ?back|go back|take (?:it|that) back)(?: (?:it|that|this))?"
                  r"(?: (?:the )?(?:last|previous) (?:change|edit))?(?: please)?[.! ]*$", re.I)
REVERT_TO = re.compile(r"\b(?:go back|revert|restore|roll ?back|return)\s+to\s+(?:version|v)\s*(\d+)\b", re.I)


def _history(db: Session, trip: Trip, limit: int = 8) -> tuple[list[dict], ChatMessage | None]:
    rows = db.scalars(select(ChatMessage).where(ChatMessage.trip_id == trip.id)
                      .order_by(ChatMessage.created_at.desc()).limit(limit)).all()
    last_assistant = next((m for m in rows if m.role == "assistant"), None)
    return [{"role": m.role, "content": m.content} for m in reversed(rows)], last_assistant


async def handle_chat(db: Session, trip: Trip, user: User, message: str, *, force_whatif: bool = False) -> ChatReply:
    base = current_itinerary(db, trip)
    assert base is not None
    req = trip_request(trip)
    history, last_assistant = _history(db, trip)
    db.add(ChatMessage(trip_id=trip.id, role="user", content=message))
    pending: dict | None = None

    reply = None if force_whatif else await _pre_route(db, trip, user, message, base, last_assistant)
    if reply is None and get_llm().enabled:
        try:
            reply = await _agent_reply(db, trip, user, message, base, history, whatif=force_whatif)
        except LLMError:
            reply = None  # the rule path below still answers
    if reply is None:
        routed = parse_message(message, base, trip.budget_inr, req.pace, travelers=req.travelers)
        if force_whatif and routed.intent in ("edit", "constraint_change"):
            routed.intent = "whatif"
        reply = await _respond(db, trip, user, routed, message, base)
        if routed.intent == "clarify" and routed.pending is not None:
            pending = routed.pending.model_dump(exclude_none=True)
    db.add(ChatMessage(
        trip_id=trip.id, role="assistant", content=reply.reply,
        payload={"intent": reply.intent, "version_id": reply.proposal.version_id if reply.proposal else reply.applied_version_id,
                 "diff_summary": reply.proposal.diff.summary if reply.proposal else None, "citations": reply.citations,
                 "steps": reply.steps, "options": reply.options, "pending": pending},
    ))
    db.commit()
    return reply


async def _pre_route(db: Session, trip: Trip, user: User, message: str, base: Itinerary,
                     last_assistant: ChatMessage | None) -> ChatReply | None:
    """Replies that never need a model: accept or discard the waiting proposal, undo, go back to a version, and
    answers to the clarifying question the rule path just asked."""
    text = message.strip()
    if CONFIRM.match(text):
        v = pending_proposal(db, trip)
        if v is None:
            return ChatReply(intent="chitchat", reply="There is no proposed change waiting. Tell me what you would like to change.")
        apply_version(db, trip, v, user)
        summary = (v.diff or {}).get("summary") or v.change_reason
        return ChatReply(intent="applied", reply=f"Done, version {v.version_no} is now your plan ({summary}). Say “undo” to go back.",
                         applied_version_id=v.id)
    if REJECT.match(text):
        v = pending_proposal(db, trip)
        if v is None:
            return ChatReply(intent="chitchat", reply="Okay, nothing changed.")
        reject_version(db, trip, v)
        return ChatReply(intent="chitchat", reply="Discarded. Your plan is unchanged.")
    m = REVERT_TO.search(text)
    if m or UNDO.match(text):
        cur = current_version(db, trip)
        if m:
            target = db.scalars(select(ItineraryVersion).where(
                ItineraryVersion.trip_id == trip.id, ItineraryVersion.version_no == int(m.group(1)))).first()
            if target is None or target.status != "applied":
                return ChatReply(intent="chitchat", reply=f"I could not find an applied version {m.group(1)} of this trip.")
        else:
            target = get_version(db, trip.id, cur.parent_version_id) if cur and cur.parent_version_id else None
            if target is None:
                return ChatReply(intent="chitchat", reply="There is nothing to undo: this is the original plan.")
        proposal = await revert_to(db, trip, target, reason=f"Go back to version {target.version_no}")
        if proposal is None:
            return ChatReply(intent="chitchat", reply=f"Version {target.version_no} is the same as your current plan.")
        return ChatReply(intent="revert", reply=f"Here is version {target.version_no} again: {proposal.diff.summary}. "
                                                 "Accept it to switch back.", proposal=proposal)
    pend = (last_assistant.payload or {}).get("pending") if last_assistant else None
    if pend:
        done = complete_pending(Change.model_validate(pend), message, base)
        if done is not None:
            routed = RouterResult("edit", ChangeRequest(changes=[done]))
            return await _respond(db, trip, user, routed, message, base)
    return None


async def _agent_reply(db: Session, trip: Trip, user: User, message: str, base: Itinerary, history: list[dict], *,
                       whatif: bool) -> ChatReply:
    req = trip_request(trip)
    weights, _ = user_context(db, user, req)
    result = None
    async for ev in run_workflow({"mode": "agent", "request": req, "base": base, "message": message, "history": history,
                                  "whatif": whatif, "weights": weights, "closed": closed_ids(trip)},
                                 "agent", {"user_id": user.id, "trip_id": trip.id}):
        if ev["type"] == "result":
            result = ev
    assert result is not None and result["state"]
    st, metrics = result["state"], result["metrics"]
    agent = st["agent"]
    if agent["kind"] == "proposal":
        label = "whatif" if whatif else "edit"
        proposal = store_proposal(db, trip, user, st, metrics, change_type=label, reason=message,
                                  extra_metrics={"steps": agent["steps"]})
        text = agent["text"]
        if not proposal.diff.changes:
            text = " ".join(proposal.notes) or "That would not change anything in the current plan."
        return ChatReply(intent=label, reply=text, proposal=proposal, steps=agent["steps"])  # type: ignore[arg-type]
    record_run(db, metrics, trip_id=trip.id, user_id=user.id)
    intent = {"clarify": "clarify", "answer": "question"}.get(agent["kind"], "chitchat")
    return ChatReply(intent=intent, reply=agent["text"], citations=agent["citations"], options=agent["options"],  # type: ignore[arg-type]
                     steps=agent["steps"])


async def _respond(db: Session, trip: Trip, user: User, routed: RouterResult, message: str, base: Itinerary) -> ChatReply:
    if routed.intent == "clarify":
        return ChatReply(intent="clarify", reply=routed.message or "Could you say a bit more?", options=routed.options)
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
    if routed.message:
        summary += " " + routed.message
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
