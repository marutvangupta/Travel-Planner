import pytest
from conftest import make_request

from travel_planner.agent.research import build_context
from travel_planner.agent.tool_client import InProcessTools
from travel_planner.schemas import Change, ChangeRequest, Itinerary
from travel_planner.services.diff import diff_itineraries
from travel_planner.services.editor import Editor, analyze_impact, repair
from travel_planner.services.planner import plan_heuristic
from travel_planner.services.validator import errors, validate


async def test_plan_is_valid_and_complete(ctx):
    itin = plan_heuristic(ctx)
    assert len(itin.days) == ctx.request.num_days
    assert errors(validate(itin, ctx)) == []
    assert itin.totals.cost_inr <= ctx.budget
    assert all(it.source_ids for _, it in itin.all_items())  # every stop is cited


async def test_opening_hours_respected(ctx):
    itin = plan_heuristic(ctx)
    for day in itin.days:
        wd = ctx.weekday(day.index)
        for it in day.items:
            windows = ctx.places[it.place_id].hours[wd]
            assert any(o <= it.start and it.end <= c for o, c in windows), (it.name, it.start, windows)


async def test_validator_catches_closed_and_budget(ctx):
    itin = plan_heuristic(ctx)
    first = itin.days[0].items[0]
    first.start, first.end = 3 * 60, 4 * 60  # nobody is open at 03:00
    codes = {v.code for v in validate(itin, ctx)}
    assert "closed_at_time" in codes
    itin.totals.cost_inr = ctx.budget + 1
    assert "over_budget" in {v.code for v in validate(itin, ctx)}


async def test_diet_and_avoid_constraints():
    req = make_request(diet="vegetarian", avoid=["museum"])
    ctx = await build_context(req, InProcessTools())
    itin = plan_heuristic(ctx)
    for _, it in itin.all_items():
        p = ctx.places[it.place_id]
        assert p.category != "museum"
        if it.category in ("restaurant", "cafe"):
            assert "vegetarian" in p.diet_tags


async def test_weather_replan_is_partial_and_stable(ctx):
    base = plan_heuristic(ctx)
    plan = analyze_impact(ctx, base, ChangeRequest(changes=[Change(kind="weather", day=0)]))
    assert plan.affected, "an outdoor stop on day 1 should be affected"
    assert all(a.day == 0 for a in plan.affected)
    new, _, _ = repair(ctx, Editor(ctx, base).run(plan))
    diff = diff_itineraries(base, new, plan.affected)
    assert diff.stability >= 0.7  # most unaffected stops stay put
    assert errors(validate(new, ctx)) == []


async def test_budget_cut_meets_target(ctx):
    base = plan_heuristic(ctx)
    target = int(base.totals.cost_inr * 0.8)
    plan = analyze_impact(ctx, base, ChangeRequest(changes=[Change(kind="budget_set", amount_inr=target)]))
    ed = Editor(ctx, base)
    new, viol, _ = repair(ctx, ed.run(plan))
    assert new.totals.cost_inr <= target
    assert not any(v.code == "over_budget" for v in viol)


async def test_locked_items_survive_automatic_changes(ctx):
    base = plan_heuristic(ctx)
    day0 = base.days[0]
    outdoor = next(i for i in day0.items if not i.indoor)
    outdoor.locked = True
    plan = analyze_impact(ctx, base, ChangeRequest(changes=[Change(kind="weather", day=0)]))
    new = Editor(ctx, base).run(plan)
    assert any(i.place_id == outdoor.place_id for _, i in new.all_items())


async def test_pace_change_trims_days(ctx):
    base = plan_heuristic(ctx)
    plan = analyze_impact(ctx, base, ChangeRequest(changes=[Change(kind="pace", pace="relaxed")]))
    new = Editor(ctx, base).run(plan)
    assert all(len(d.items) <= 4 for d in new.days)


async def test_closure_replaces_item(ctx):
    base = plan_heuristic(ctx)
    victim = base.days[1].items[0]
    plan = analyze_impact(ctx, base, ChangeRequest(changes=[Change(kind="closure", item_id=victim.id, place_name=victim.name)]))
    new, _, _ = repair(ctx, Editor(ctx, base).run(plan))
    assert all(i.place_id != victim.place_id for _, i in new.all_items())


async def test_itinerary_roundtrips_json(ctx):
    base = plan_heuristic(ctx)
    again = Itinerary.model_validate(base.model_dump(mode="json"))
    assert again.totals == base.totals


@pytest.mark.parametrize("dest", ["Goa", "Tokyo", "Paris"])
async def test_other_destinations_plan(dest):
    ctx = await build_context(make_request(destination=dest, budget_inr=90000), InProcessTools())
    itin = plan_heuristic(ctx)
    assert errors(validate(itin, ctx)) == []
    assert itin.totals.items >= 8
