"""LangGraph workflows.

create:  intake -> research -> plan -> validate <-> repair_llm (bounded) -> fix -> ground
change:  intake -> research -> impact -> replan (partial, with repair) -> ground
agent:   intake -> research -> agent_edit (tool-calling loop over the same edit engine) -> ground

Planning/replacement choice may use the LLM; everything that decides validity is deterministic code.
Nodes stream progress events (stage start/done) so the UI can show what the agent is doing.
"""

from __future__ import annotations

import asyncio
import operator
import time
from collections.abc import AsyncIterator
from typing import Annotated, Any, TypedDict

import structlog
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from ..config import get_settings
from ..schemas import AffectedItem, ChangeRequest, Diff, Itinerary, PlanOut, TripRequest, Violation
from ..services.context import PlanContext
from ..services.diff import diff_itineraries
from ..services.editor import (
    Editor,
    ImpactPlan,
    analyze_impact,
    attach_warnings,
    execute_plan,
    repair,
    resolve_place,
)
from ..services.planner import plan_heuristic
from ..services.scheduler import collect_sources
from ..services.tracking import current_tracker, start_run
from ..services.validator import errors, validate
from .edit_agent import run_edit_agent
from .llm import LLMError, get_llm
from .llm_planner import llm_choose_replacement, llm_plan, plan_to_itinerary
from .research import apply_text_rules, build_context, register_user_places
from .tool_client import get_tools

log = structlog.get_logger()


class State(TypedDict, total=False):
    mode: str  # create | change | agent
    request: TripRequest
    weights: dict[str, float]
    memories: list[str]
    closed: list[str]
    base: Itinerary
    change: ChangeRequest
    ctx: PlanContext
    plan_out: PlanOut | None
    draft: Itinerary
    violations: list[Violation]
    first_error_count: int
    repair_count: int
    impact: ImpactPlan
    affected: list[AffectedItem]
    diff: Diff
    request_patch: dict
    notes: Annotated[list[str], operator.add]
    stats: dict
    planner: str
    message: str  # agent mode: the traveller's message, recent chat history and whether it is a what-if
    history: list[dict]
    whatif: bool
    agent: dict  # agent mode: kind, text, options, citations, steps


def stage(name: str, label: str):  # noqa: ANN201
    def deco(fn):  # noqa: ANN001, ANN202
        async def wrapped(state: State) -> dict:
            writer = get_stream_writer()
            writer({"type": "stage", "node": name, "status": "start", "label": label})
            started = time.perf_counter()
            out = await fn(state)
            dt = time.perf_counter() - started
            current_tracker().add_node(name, dt)
            detail = out.pop("_detail", "")
            writer({"type": "stage", "node": name, "status": "done", "label": label, "detail": detail, "ms": int(dt * 1000)})
            return out

        wrapped.__name__ = name
        return wrapped

    return deco


# ----------------------------------------------------------------------------- shared nodes


@stage("intake", "Reading your trip request")
async def intake(state: State) -> dict:
    req = apply_text_rules(state["request"]).model_copy(deep=True)  # edits change ctx.request; never the caller's
    bits = [f"{req.num_days} days", ", ".join(req.interests) or "open interests"]
    if req.diet != "none":
        bits.append(req.diet)
    if req.step_free:
        bits.append("step-free")
    if req.avoid:
        bits.append("avoid " + ", ".join(req.avoid))
    return {"request": req, "_detail": " · ".join(bits), "repair_count": 0, "notes": [], "stats": {}}


@stage("research", "Checking places, routes, weather and local guides")
async def research(state: State) -> dict:
    ctx = await build_context(state["request"], get_tools(), weights=state.get("weights"))
    ctx.closed = set(state.get("closed", []))
    if state.get("base") is not None:
        await register_user_places(ctx, state["base"])
    rainy = sum(1 for d in range(ctx.request.num_days) if ctx.is_rainy(d))
    return {
        "ctx": ctx,
        "_detail": f"{len(ctx.places)} places · {len(ctx.weather)} weather days"
                   f"{f' ({rainy} rainy)' if rainy else ''} · {len(ctx.guides)} guide notes",
    }


@stage("ground", "Verifying sources and finishing")
async def ground(state: State) -> dict:
    ctx: PlanContext = state["ctx"]
    draft = state["draft"]
    violations = state.get("violations") or validate(draft, ctx)
    draft = attach_warnings(draft, violations)
    draft.sources = collect_sources(ctx, draft.days)
    items = draft.all_items()
    cited = sum(1 for _, it in items if any(s in draft.sources for s in it.source_ids))
    stats = dict(state.get("stats") or {})
    stats["citation_coverage"] = round(cited / len(items), 3) if items else 1.0
    stats["hard_violations"] = len(errors(violations))
    stats["warnings"] = sum(1 for v in violations if v.severity == "warning")
    stats["valid_first_try"] = state.get("first_error_count", 0) == 0
    return {"draft": draft, "violations": violations, "stats": stats,
            "_detail": f"{cited}/{len(items)} stops cited · {stats['hard_violations']} hard issues"}


# ----------------------------------------------------------------------------- create flow


@stage("plan", "Drafting the itinerary")
async def plan(state: State) -> dict:
    ctx: PlanContext = state["ctx"]
    llm = get_llm()
    notes: list[str] = []
    stats = dict(state.get("stats") or {})
    if llm.enabled:
        try:
            plan_out = await llm_plan(llm, ctx, state.get("memories", []))
            draft, g = plan_to_itinerary(ctx, plan_out)
            stats.update(g)
            current_tracker().planner = "llm"
            return {"draft": draft, "plan_out": plan_out, "planner": "llm", "stats": stats, "notes": notes,
                    "_detail": f"{draft.totals.items} stops planned by the model"}
        except LLMError as exc:
            log.warning("plan.llm_failed", error=str(exc))
            notes.append("The language model was unavailable, so I used the built-in planner.")
    draft = plan_heuristic(ctx)
    current_tracker().planner = "heuristic"
    return {"draft": draft, "plan_out": None, "planner": "heuristic", "stats": stats, "notes": notes,
            "_detail": f"{draft.totals.items} stops planned by the built-in planner"}


@stage("validate", "Checking opening hours, travel time and budget")
async def validate_node(state: State) -> dict:
    ctx, draft = state["ctx"], state["draft"]
    violations = validate(draft, ctx)
    errs = errors(violations)
    out: dict[str, Any] = {"violations": violations,
                           "_detail": f"{len(errs)} hard issue(s), {len(violations) - len(errs)} warning(s)"}
    if "first_error_count" not in state:
        out["first_error_count"] = len(errs)
    return out


def route_validate(state: State) -> str:
    errs = errors(state.get("violations", []))
    if not errs:
        return "ground"
    if state.get("plan_out") is not None and state.get("repair_count", 0) < get_settings().max_repair_loops:
        return "repair_llm"
    return "fix"


@stage("repair_llm", "Asking the model to fix the issues")
async def repair_llm(state: State) -> dict:
    ctx: PlanContext = state["ctx"]
    count = state.get("repair_count", 0) + 1
    current_tracker().repair_loops += 1
    try:
        plan_out = await llm_plan(get_llm(), ctx, state.get("memories", []), previous=state["plan_out"],
                                  violations=state["violations"])
        draft, g = plan_to_itinerary(ctx, plan_out)
        return {"draft": draft, "plan_out": plan_out, "repair_count": count, "_detail": f"attempt {count}"}
    except LLMError:
        return {"plan_out": None, "repair_count": count, "_detail": "model could not repair; using the built-in fixer"}


@stage("fix", "Repairing remaining issues")
async def fix(state: State) -> dict:
    ctx: PlanContext = state["ctx"]
    draft, violations, loops = repair(ctx, state["draft"])
    current_tracker().repair_loops += loops
    return {"draft": draft, "violations": violations, "_detail": f"{loops} repair pass(es)"}


# ----------------------------------------------------------------------------- change flow


async def resolve_named_places(ctx: PlanContext, cr: ChangeRequest) -> None:
    """A named place that is not among the candidates is looked up once, so "add X" can work for any real place."""
    for ch in cr.changes:
        if ch.kind != "add_place" or ch.place_id or not ch.place_name or resolve_place(ctx, ch.place_name):
            continue
        try:
            found = await get_tools().find_place(ctx.geo.name, ch.place_name, ctx.base[0], ctx.base[1])
        except Exception as exc:  # the change then reports that the place was not found
            log.warning("find_place.failed", error=str(exc))
            continue
        if found:
            ctx.register_place(found[0], extra=found[0].place_id not in ctx.places)
            ch.place_id = found[0].place_id


@stage("impact", "Finding which stops are affected")
async def impact(state: State) -> dict:
    ctx: PlanContext = state["ctx"]
    await resolve_named_places(ctx, state["change"])
    plan_ = analyze_impact(ctx, state["base"], state["change"])
    return {"impact": plan_, "_detail": f"{len(plan_.affected)} stop(s) directly affected"}


@stage("replan", "Re-planning only what changed")
async def replan(state: State) -> dict:
    ctx: PlanContext = state["ctx"]
    base: Itinerary = state["base"]
    plan_: ImpactPlan = state["impact"]
    ed = Editor(ctx, base)
    llm = get_llm()
    if llm.enabled:
        async def choose(a):  # noqa: ANN001, ANN202
            cands = ed.feasible_candidates(a.item_id, indoor=a.indoor, cheaper=a.cheaper, interest=a.interest)
            loc = ed.locate(a.item_id)
            if not cands or not loc:
                return
            try:
                a.preferred = await llm_choose_replacement(llm, ctx, ctx.places[loc[1].place_id], a.reason, cands)
            except LLMError:
                a.preferred = None

        await asyncio.gather(*(choose(a) for a in plan_.actions if a.kind == "replace" and a.item_id))
    res = execute_plan(ctx, base, plan_)
    current_tracker().repair_loops += res.repair_loops
    return {
        "draft": res.itinerary, "violations": res.violations, "affected": res.affected, "diff": res.diff,
        "request_patch": res.request_patch, "notes": res.notes, "planner": base.planner,
        "_detail": f"{res.diff.summary} · {round(res.diff.stability * 100)}% of other stops unchanged",
    }


@stage("agent_edit", "Working on your request")
async def agent_edit(state: State) -> dict:
    ctx: PlanContext = state["ctx"]
    base: Itinerary = state["base"]
    writer = get_stream_writer()
    out = await run_edit_agent(
        get_llm(), ctx, base, state["message"], state.get("history", []), whatif=state.get("whatif", False),
        on_step=lambda label: writer({"type": "step", "node": "agent_edit", "label": label}),
    )
    reply = {"kind": out.kind, "text": out.text, "options": out.options, "citations": out.citations, "steps": out.steps}
    if out.kind == "proposal":
        res = out.session.finish()
        return {
            "draft": res.itinerary, "violations": res.violations, "affected": res.affected, "diff": res.diff,
            "request_patch": res.request_patch, "notes": res.notes, "planner": base.planner, "agent": reply,
            "_detail": f"{len(out.steps)} step(s) · {res.diff.summary}",
        }
    return {"draft": base, "violations": validate(base, ctx), "affected": [], "diff": diff_itineraries(base, base),
            "request_patch": {}, "planner": base.planner, "agent": reply, "_detail": f"{len(out.steps)} step(s) · {out.kind}"}


# ----------------------------------------------------------------------------- wiring


def build_graph():  # noqa: ANN201
    g = StateGraph(State)
    for name, fn in [("intake", intake), ("research", research), ("plan", plan), ("validate", validate_node),
                     ("repair_llm", repair_llm), ("fix", fix), ("ground", ground), ("impact", impact), ("replan", replan),
                     ("agent_edit", agent_edit)]:
        g.add_node(name, fn)
    g.add_edge(START, "intake")
    g.add_edge("intake", "research")
    g.add_conditional_edges("research", lambda s: {"create": "plan", "agent": "agent_edit"}.get(s["mode"], "impact"),
                            {"plan": "plan", "impact": "impact", "agent_edit": "agent_edit"})
    g.add_edge("plan", "validate")
    g.add_conditional_edges("validate", route_validate, {"repair_llm": "repair_llm", "fix": "fix", "ground": "ground"})
    g.add_edge("repair_llm", "validate")
    g.add_edge("fix", "ground")
    g.add_edge("impact", "replan")
    g.add_edge("replan", "ground")
    g.add_edge("agent_edit", "ground")
    g.add_edge("ground", END)
    return g.compile()


_graph = None


def get_graph():  # noqa: ANN201
    global _graph
    if _graph is None:
        _graph = build_graph()
    return _graph


def _langfuse_config(workflow: str, meta: dict) -> dict:
    s = get_settings()
    if not s.langfuse_enabled:
        return {}
    try:  # optional dependency; tracing must never break a request
        from langfuse.langchain import CallbackHandler  # type: ignore[import-not-found]

        return {"callbacks": [CallbackHandler()], "metadata": {"langfuse_session_id": meta.get("trip_id"),
                                                                "langfuse_user_id": meta.get("user_id"),
                                                                "langfuse_tags": [workflow]}}
    except Exception as exc:
        log.warning("langfuse.unavailable", error=str(exc))
        return {}


async def run_workflow(state: State, workflow: str, meta: dict | None = None) -> AsyncIterator[dict]:
    """Yield stage events, then a final {'type': 'result', 'state', 'metrics'} event."""
    tracker = start_run(workflow)
    final: State | None = None
    config = _langfuse_config(workflow, meta or {})
    async for mode, chunk in get_graph().astream(state, config=config, stream_mode=["custom", "values"]):
        if mode == "custom":
            yield chunk
        else:
            final = chunk
    tracker.planner = (final or {}).get("planner", tracker.planner)
    yield {"type": "result", "state": final, "metrics": tracker.summary()}
