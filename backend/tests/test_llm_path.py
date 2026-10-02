"""Exercise the LLM planning path with a stubbed model (no network): grounding, repair loop, fallback."""
import json

import pytest
from conftest import make_request

from travel_planner.agent import graph as graph_mod
from travel_planner.agent import llm as llm_mod
from travel_planner.agent.llm import LLMError
from travel_planner.config import get_settings
from travel_planner.schemas import PlanDay, PlanItem, PlanOut
from travel_planner.services.planner import plan_heuristic


class FakeLLM:
    enabled = True

    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = 0

    async def parse(self, **kw):
        self.calls += 1
        out = self.outputs.pop(0)
        if isinstance(out, Exception):
            raise out
        return out


def _plan_from(itin, *, break_it=False):
    days = []
    for d in itin.days:
        items = [PlanItem(place_id=i.place_id, slot=i.slot, why="fits you", source_ids=[i.place_id, "guide:fake-99"]) for i in d.items]
        days.append(PlanDay(day=d.index, theme="t", tip="a tip", tip_source_ids=["guide:not-real"], items=items))
    if break_it:
        days[0].items.append(PlanItem(place_id="demo:jaipur:does-not-exist", slot="afternoon", why="invented", source_ids=[]))
        days[0].items[0] = PlanItem(place_id=days[0].items[0].place_id, slot="morning", why="x", source_ids=[])
    return PlanOut(days=days, assumptions=["a"])


@pytest.fixture
def patch_llm(monkeypatch):
    def apply(fake):
        monkeypatch.setattr(graph_mod, "get_llm", lambda: fake)
        monkeypatch.setattr(llm_mod, "_llm", fake)
        monkeypatch.setattr(get_settings(), "force_demo", True)
        return fake
    return apply


async def _run(req):
    final = None
    async for ev in graph_mod.run_workflow({"mode": "create", "request": req, "weights": {}, "memories": []}, "create"):
        if ev["type"] == "result":
            final = ev["state"]
    return final


async def test_llm_plan_is_grounded(patch_llm, ctx):
    good = _plan_from(plan_heuristic(ctx))
    fake = patch_llm(FakeLLM([good]))
    st = await _run(make_request())
    assert st["planner"] == "llm" and fake.calls == 1
    itin = st["draft"]
    # invented citations are dropped; tips without a real source are discarded
    assert all(s in itin.sources for _, it in itin.all_items() for s in it.source_ids)
    assert all(d.tip is None for d in itin.days)


async def test_invented_places_are_dropped_and_repaired(patch_llm, ctx):
    base = plan_heuristic(ctx)
    bad = _plan_from(base, break_it=True)
    fixed = _plan_from(base)
    patch_llm(FakeLLM([bad, fixed]))
    st = await _run(make_request())
    assert st["stats"]["dropped_unknown"] == 1
    assert st["stats"]["hard_violations"] == 0


async def test_llm_failure_falls_back_to_builtin_planner(patch_llm):
    patch_llm(FakeLLM([LLMError("provider down")]))
    st = await _run(make_request())
    assert st["planner"] == "heuristic"
    assert st["stats"]["hard_violations"] == 0
    assert any("unavailable" in n for n in st["notes"])


# ----------------------------------------------------------------------------- the tool-calling edit agent


class ScriptedAgent:
    """Plays back tool calls in order; records what it was sent so tests can check the loop fed results back."""

    enabled = True

    def __init__(self, turns):
        self.turns = list(turns)
        self.seen: list[list[dict]] = []

    async def run_tools(self, *, messages, **kw):
        from types import SimpleNamespace

        self.seen.append(list(messages))
        turn = self.turns.pop(0)
        if isinstance(turn, Exception):
            raise turn
        name, args = turn
        call = SimpleNamespace(id=f"c{len(self.seen)}", function=SimpleNamespace(name=name, arguments=json.dumps(args)))
        return SimpleNamespace(content=None, tool_calls=[call])

    async def parse(self, **kw):
        raise LLMError("not scripted")


def _tool_results(fake):
    return [json.loads(m["content"]) for m in fake.seen[-1] if m.get("role") == "tool"]


async def test_agent_looks_up_a_place_adds_it_and_proposes(ctx):
    from travel_planner.agent.edit_agent import run_edit_agent

    base = plan_heuristic(ctx)
    used = {it.place_id for _, it in base.all_items()}
    spare = next(p for p in ctx.places.values() if p.place_id not in used and ctx.allowed(p) and "nightlife" not in p.tags)
    fake = ScriptedAgent([
        ("find_places", {"query": spare.name}),
        ("apply_changes", {"changes": [{"kind": "add_place", "place_id": spare.place_id, "day": 2}]}),
        ("reply", {"kind": "proposal", "text": f"Added {spare.name} on day 2.", "options": [], "source_ids": []}),
    ])
    out = await run_edit_agent(fake, ctx, base, f"add {spare.name} to day 2")
    assert out.kind == "proposal" and len(out.steps) == 2
    found = _tool_results(fake)[0]["places"]
    assert found[0]["place_id"] == spare.place_id
    res = out.session.finish()
    assert any(c.kind == "added" and c.name == spare.name for c in res.diff.changes)
    assert spare.name in [i.name for i in res.itinerary.days[1].items]


async def test_agent_cannot_invent_places_and_nothing_is_proposed(ctx):
    from travel_planner.agent.edit_agent import run_edit_agent

    base = plan_heuristic(ctx)
    fake = ScriptedAgent([
        ("apply_changes", {"changes": [{"kind": "add_place", "place_id": "demo:jaipur:made-up", "item_name": "Imaginary Palace",
                                        "day": 1}]}),
        ("reply", {"kind": "proposal", "text": "Done", "options": [], "source_ids": []}),
    ])
    out = await run_edit_agent(fake, ctx, base, "add Imaginary Palace")
    result = _tool_results(fake)[0]
    assert result["ok"] is False and "could not find" in result["notes"][0]
    assert out.kind == "chitchat"  # a proposal with no applied change is downgraded


async def test_agent_clarifies_with_options(ctx):
    from travel_planner.agent.edit_agent import run_edit_agent

    base = plan_heuristic(ctx)
    fake = ScriptedAgent([("reply", {"kind": "clarify", "text": "Which day?", "options": ["Day 1", "Day 2", " "],
                                     "source_ids": []})])
    out = await run_edit_agent(fake, ctx, base, "add a flight at 6pm")
    assert out.kind == "clarify" and out.options == ["Day 1", "Day 2"]


async def test_agent_answers_cite_only_what_it_saw(ctx):
    from travel_planner.agent.edit_agent import run_edit_agent

    base = plan_heuristic(ctx)
    fake = ScriptedAgent([
        ("search_guides", {"query": "getting around"}),
        ("reply", {"kind": "answer", "text": "Use the metro.", "options": [], "source_ids": ["guide:invented-1"]}),
    ])
    out = await run_edit_agent(fake, ctx, base, "how do I get around?")
    passages = _tool_results(fake)[0]["passages"]
    assert out.kind == "answer" and out.citations == []
    if passages:
        fake = ScriptedAgent([("search_guides", {"query": "getting around"}),
                              ("reply", {"kind": "answer", "text": "x", "options": [], "source_ids": [passages[0]["id"]]})])
        assert (await run_edit_agent(fake, ctx, base, "q")).citations == [passages[0]["id"]]


async def test_agent_undo_step_restores_the_draft(ctx):
    from travel_planner.agent.edit_agent import run_edit_agent

    base = plan_heuristic(ctx)
    fake = ScriptedAgent([
        ("apply_changes", {"changes": [{"kind": "clear_day", "day": 1}]}),
        ("undo_step", {}),
        ("apply_changes", {"changes": [{"kind": "set_theme", "day": 1, "text": "Slow start"}]}),
        ("reply", {"kind": "proposal", "text": "Renamed day 1.", "options": [], "source_ids": []}),
    ])
    out = await run_edit_agent(fake, ctx, base, "rename day 1")
    res = out.session.finish()
    assert [c.kind for c in res.diff.changes] == ["edited"]
    assert len(res.itinerary.days[0].items) == len(base.days[0].items)


async def test_agent_out_of_turns_without_changes_raises(ctx, monkeypatch):
    from travel_planner.agent.edit_agent import run_edit_agent

    monkeypatch.setattr(get_settings(), "agent_max_turns", 2)
    base = plan_heuristic(ctx)
    fake = ScriptedAgent([("view_itinerary", {"day": None}), ("check_plan", {})])
    with pytest.raises(LLMError):
        await run_edit_agent(fake, ctx, base, "hmm")


def test_chat_uses_the_agent_and_falls_back_to_rules(patch_llm):
    from fastapi.testclient import TestClient

    from travel_planner.api.main import create_app

    with TestClient(create_app()) as client:
        tok = client.post("/api/auth/register", json={"email": "agent@example.com", "password": "pw-pw-pw-pw"}).json()["token"]
        auth = {"authorization": f"Bearer {tok}"}
        body = {"destination": "Jaipur", "start_date": "2026-11-10", "end_date": "2026-11-13", "budget_inr": 40000,
                "travelers": 2, "interests": ["history", "food"], "pace": "balanced"}
        with client.stream("POST", "/api/trips/stream", json=body, headers=auth) as r:
            final = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")][-1]
        trip_id, itin = final["trip_id"], final["itinerary"]
        name = itin["days"][0]["items"][0]["name"]

        patch_llm(ScriptedAgent([
            ("apply_changes", {"changes": [{"kind": "move_item", "item_name": name, "to_day": 3}]}),
            ("reply", {"kind": "proposal", "text": f"Moved {name} to day 3.", "options": [], "source_ids": []}),
        ]))
        r = client.post(f"/api/trips/{trip_id}/chat", json={"message": f"put {name} on day 3"}, headers=auth).json()
        assert r["intent"] == "edit" and r["reply"] == f"Moved {name} to day 3." and r["steps"]
        assert any(c["kind"] == "moved" for c in r["proposal"]["diff"]["changes"])

        patch_llm(ScriptedAgent([LLMError("provider down")]))
        r = client.post(f"/api/trips/{trip_id}/chat", json={"message": "clear day 2"}, headers=auth).json()
        assert r["intent"] == "edit" and r["proposal"]["version_id"]  # the rule path answered
