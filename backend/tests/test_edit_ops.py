"""Itinerary CRUD operations: each change runs through impact analysis, the editor and repair, offline."""
import pytest

from travel_planner.agent.research import register_user_places
from travel_planner.schemas import Change, ChangeRequest
from travel_planner.services.editor import analyze_impact, execute_plan
from travel_planner.services.planner import plan_heuristic
from travel_planner.services.scheduler import entries_from_day, schedule_day
from travel_planner.services.validator import errors, validate


def run(ctx, itin, *changes):
    plan = analyze_impact(ctx, itin, ChangeRequest(changes=list(changes)))
    return execute_plan(ctx, itin, plan)


def where(itin, name):
    return next(((d.index, it) for d, it in itin.all_items() if it.name == name), (None, None))


def hard(ctx, itin):
    return [v for v in errors(validate(itin, ctx)) if v.code != "over_budget"]


@pytest.fixture
def itin(ctx):
    return plan_heuristic(ctx)


async def test_move_to_another_day_keeps_the_rest_in_place(ctx, itin):
    name = itin.days[0].items[0].name
    res = run(ctx, itin, Change(kind="move_item", place_name=name, to_day=2))
    day, it = where(res.itinerary, name)
    assert day == 2 and it.user_set
    assert res.diff.stability >= 0.8
    assert any(c.kind == "moved" and c.name == name for c in res.diff.changes)
    assert not [v for v in res.violations if v.severity == "error" and v.code != "over_budget"]


async def test_retime_to_a_slot_and_to_a_clock_time(ctx, itin):
    name = itin.days[0].items[0].name
    res = run(ctx, itin, Change(kind="retime_item", place_name=name, slot="afternoon"))
    _, it = where(res.itinerary, name)
    assert it.slot == "afternoon" and it.start >= 14 * 60 + 30
    res = run(ctx, itin, Change(kind="retime_item", place_name=name, start_min=10 * 60))
    _, it = where(res.itinerary, name)
    assert it.start == 10 * 60 and it.fixed_start == 10 * 60


async def test_duration_override_survives_a_round_trip(ctx, itin):
    name = itin.days[1].items[0].name
    res = run(ctx, itin, Change(kind="set_duration", place_name=name, duration_min=180))
    day, it = where(res.itinerary, name)
    assert it.end - it.start == 180
    again = schedule_day(ctx, day, entries_from_day(res.itinerary.days[day]))
    assert next(i for i in again.items if i.name == name).end - it.start == 180
    assert any(c.kind == "edited" and "3h00" in c.detail for c in res.diff.changes)


async def test_note_and_lock_are_visible_edits(ctx, itin):
    name = itin.days[0].items[1].name
    res = run(ctx, itin, Change(kind="edit_item", place_name=name, text="Book tickets online"))
    assert where(res.itinerary, name)[1].note == "Book tickets online"
    assert [c.kind for c in res.diff.changes] == ["edited"]
    res = run(ctx, itin, Change(kind="lock", place_name=name))
    assert where(res.itinerary, name)[1].locked
    assert res.diff.changes and res.diff.changes[0].kind == "edited"
    res2 = run(ctx, res.itinerary, Change(kind="unlock", place_name=name))
    assert not where(res2.itinerary, name)[1].locked


async def test_add_a_named_place(ctx, itin):
    used = {it.place_id for _, it in itin.all_items()}
    spare = next(p for p in ctx.places.values() if p.place_id not in used and ctx.allowed(p)
                 and "nightlife" not in p.tags)
    res = run(ctx, itin, Change(kind="add_place", place_name=spare.name.lower(), day=1))
    day, it = where(res.itinerary, spare.name)
    assert day == 1 and it.user_set
    assert len(res.itinerary.days[1].items) <= 5  # the pace cap still holds: something made room


async def test_add_a_place_already_in_the_plan_moves_it(ctx, itin):
    name = itin.days[0].items[0].name
    res = run(ctx, itin, Change(kind="add_place", place_name=name, day=3))
    assert where(res.itinerary, name)[0] == 3


async def test_unknown_place_is_reported_not_invented(ctx, itin):
    plan = analyze_impact(ctx, itin, ChangeRequest(changes=[Change(kind="add_place", place_name="Eiffel Tower")]))
    assert not plan.actions and "could not find" in plan.notes[0]


async def test_custom_entry_has_its_fixed_time_and_displaces_what_collides(ctx, itin):
    last = len(itin.days) - 1
    res = run(ctx, itin, Change(kind="add_custom", text="Flight to Mumbai", custom_kind="transport", day=last,
                                start_min=18 * 60))
    day, it = where(res.itinerary, "Flight to Mumbai")
    assert day == last and it.custom and it.start == 18 * 60 and it.end == 20 * 60
    assert it.place_id in res.itinerary.custom_places
    assert not hard(ctx, res.itinerary)  # nothing planned runs into the flight
    # the entry stays known to later edits after a fresh research step
    ctx2 = ctx
    for pid in list(ctx2.places):
        if pid.startswith("custom:"):
            del ctx2.places[pid]
    await register_user_places(ctx2, res.itinerary)
    res2 = run(ctx2, res.itinerary, Change(kind="edit_item", place_name="Flight to Mumbai", text="Terminal 2"))
    assert where(res2.itinerary, "Flight to Mumbai")[1].note == "Terminal 2"


async def test_custom_meal_replaces_the_planned_meal_in_that_slot(ctx, itin):
    res = run(ctx, itin, Change(kind="add_custom", text="Dinner with friends", custom_kind="meal", day=1,
                                start_min=20 * 60))
    dinners = [i for i in res.itinerary.days[1].items if i.slot == "dinner"]
    assert [i.name for i in dinners] == ["Dinner with friends"]
    assert not any(v.code == "missing_meal" and v.day == 1 for v in res.violations)


async def test_custom_entries_skip_provider_checks_and_the_pace_cap(ctx, itin):
    res = run(ctx, itin, Change(kind="add_custom", text="Spa appointment", custom_kind="activity", day=0,
                                start_min=17 * 60, duration_min=60))
    _, it = where(res.itinerary, "Spa appointment")
    codes = {v.code for v in res.violations if v.item_id == it.id}
    assert not codes & {"hours_unverified", "access_unverified", "too_many_items"}


async def test_swap_days_keeps_the_swap_even_when_it_rains(ctx, itin):
    a, b = itin.days[0], itin.days[1]
    res = run(ctx, itin, Change(kind="swap_days", day=0, to_day=1))
    assert {i.name for i in res.itinerary.days[1].items} == {i.name for i in a.items}
    assert {i.name for i in res.itinerary.days[0].items} == {i.name for i in b.items}
    assert res.itinerary.days[0].theme == b.theme
    assert not [v for v in res.violations if v.severity == "error" and v.code != "over_budget"]


async def test_clear_day_keeps_locked_stops(ctx, itin):
    keep = itin.days[2].items[0].name
    locked = run(ctx, itin, Change(kind="lock", place_name=keep)).itinerary
    res = run(ctx, locked, Change(kind="clear_day", day=2))
    assert [i.name for i in res.itinerary.days[2].items] == [keep]
    assert sum(1 for c in res.diff.changes if c.kind == "removed") == len(itin.days[2].items) - 1


async def test_theme_change(ctx, itin):
    res = run(ctx, itin, Change(kind="set_theme", day=0, text="Old city walk"))
    assert res.itinerary.days[0].theme == "Old city walk"
    assert res.diff.changes[0].name == "Day 1"


async def test_vegetarian_diet_swaps_meals_that_do_not_fit(ctx, itin):
    res = run(ctx, itin, Change(kind="set_constraints", diet="vegetarian"))
    assert res.request_patch["diet"] == "vegetarian"
    for _, it in res.itinerary.all_items():
        p = ctx.places[it.place_id]
        if it.category in ("restaurant", "cafe"):
            assert "vegetarian" in p.diet_tags


async def test_more_travellers_scales_costs(ctx, itin):
    res = run(ctx, itin, Change(kind="set_constraints", travelers=3))
    assert res.request_patch["travelers"] == 3
    assert res.itinerary.totals.cost_inr <= ctx.budget or res.notes


async def test_a_stop_you_place_is_kept_with_a_warning_instead_of_removed(ctx, itin):
    # put a stop at a time its hours do not allow: repair must not silently undo the request
    victim = next((it for _, it in itin.all_items() if ctx.places[it.place_id].hours), None)
    assert victim is not None
    res = run(ctx, itin, Change(kind="retime_item", place_name=victim.name, start_min=23 * 60))
    day, it = where(res.itinerary, victim.name)
    assert it is not None and it.fixed_start == 23 * 60
    mine = [v for v in res.violations if v.item_id == it.id]
    assert mine and all(v.severity == "warning" and v.message.startswith("You asked for this") for v in mine)


async def test_out_of_range_days_ask_instead_of_guessing(ctx, itin):
    plan = analyze_impact(ctx, itin, ChangeRequest(changes=[Change(kind="clear_day", day=9)]))
    assert not plan.actions and "1 to 4" in plan.notes[0]
