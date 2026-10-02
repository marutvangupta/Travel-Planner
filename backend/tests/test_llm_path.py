"""Exercise the LLM planning path with a stubbed model (no network): grounding, repair loop, fallback."""
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
