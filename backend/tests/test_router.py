import pytest
from conftest import make_request

from travel_planner.agent.research import apply_text_rules
from travel_planner.agent.router import answer_question, parse_amount, parse_message
from travel_planner.services.planner import plan_heuristic


@pytest.mark.parametrize("text,amount", [("₹15,000", 15000), ("15k", 15000), ("rs 2500", 2500), ("1.5 lakh", 150000)])
def test_parse_amount(text, amount):
    assert parse_amount(text) == amount


async def test_router_cases(ctx):
    itin = plan_heuristic(ctx)
    r = parse_message("What if I reduce my budget by ₹15,000?", itin, 40000, "balanced")
    assert r.intent == "whatif" and r.request.changes[0].amount_inr == -15000
    r = parse_message("it's going to rain on day 2", itin, 40000, "balanced")
    assert r.request.changes[0].kind == "weather" and r.request.changes[0].day == 1
    r = parse_message("make it more relaxed", itin, 40000, "balanced")
    assert r.request.changes[0].pace == "relaxed"
    r = parse_message("no more nightlife please", itin, 40000, "balanced")
    assert r.request.changes[0].kind == "avoid"
    r = parse_message("is day 1 too packed?", itin, 40000, "balanced")
    assert r.intent == "question"
    name = itin.days[0].items[0].name
    r = parse_message(f"remove {name}", itin, 40000, "balanced")
    assert r.request.changes[0].kind == "remove_item"
    r = parse_message("blah blah", itin, 40000, "balanced")
    assert r.intent == "chitchat"


async def test_answer_question_uses_itinerary(ctx):
    itin = plan_heuristic(ctx)
    text, _ = answer_question("how much will this cost?", itin, [])
    assert f"{itin.totals.cost_inr:,}" in text


def test_text_rules():
    req = apply_text_rules(make_request(constraints_text="We are vegan, no early mornings, wheelchair user, skip museums"))
    assert req.diet == "vegan" and req.late_starts and req.step_free and "museum" in req.avoid


PRESET_TEXTS = [
    "What if I reduce my budget by ₹10,000?", "What if I reduce my budget by ₹25,000?", "What if I increase my budget by ₹20,000?",
    "What if I take it slower?", "What if it rains on day 2?", "What if I start later each day?", "What if I skip nightlife?",
]


@pytest.mark.parametrize("text", PRESET_TEXTS)
async def test_every_ui_preset_parses_as_a_whatif(ctx, text):
    from travel_planner.agent.router import parse_message as parse
    from travel_planner.services.planner import plan_heuristic as plan

    r = parse(text, plan(ctx), 40000, "balanced")
    assert r.intent == "whatif" and r.request.changes, text


# ----------------------------------------------------------------------------- itinerary CRUD phrasing


@pytest.mark.parametrize("text,minutes", [("10am", 600), ("1:30 pm", 810), ("18:00", 1080), ("at 6", 1080), ("noon", 720),
                                          ("8.30pm", 1230), ("day 2", None), ("₹1.50", None), ("1.5 lakh", None)])
def test_parse_time(text, minutes):
    from travel_planner.agent.router import parse_time

    assert parse_time(text) == minutes


@pytest.mark.parametrize("text,minutes", [("2 hours", 120), ("90 minutes", 90), ("1.5h", 90), ("2h30", 150),
                                          ("an hour and a half", 90), ("18:00", None)])
def test_parse_duration(text, minutes):
    from travel_planner.agent.router import parse_duration

    assert parse_duration(text) == minutes


def _one(r):
    assert r.intent in ("edit", "constraint_change"), (r.intent, r.message)
    assert len(r.request.changes) == 1
    return r.request.changes[0]


async def test_crud_phrases(ctx):
    itin = plan_heuristic(ctx)
    first = itin.days[0].items[0].name
    p = lambda text: parse_message(text, itin, 40000, "balanced", travelers=2)  # noqa: E731

    c = _one(p(f"Move {first} to day 3"))
    assert (c.kind, c.place_name, c.to_day) == ("move_item", first, 2)
    c = _one(p(f"could you move {first} to the afternoon?"))
    assert (c.kind, c.slot) == ("retime_item", "afternoon")
    c = _one(p(f"{first} at 10am"))
    assert (c.kind, c.start_min) == ("retime_item", 600)
    c = _one(p(f"spend 3 hours at {first}"))
    assert (c.kind, c.duration_min) == ("set_duration", 180)
    c = _one(p(f"add a note to {first}: book tickets online"))
    assert (c.kind, c.text) == ("edit_item", "book tickets online")
    c = _one(p("add a flight to Mumbai at 18:00 on day 4"))
    assert (c.kind, c.text, c.custom_kind, c.day, c.start_min) == ("add_custom", "Flight to Mumbai", "transport", 3, 1080)
    c = _one(p("add dinner with friends at 8pm on day 2"))
    assert (c.custom_kind, c.text) == ("meal", "Dinner with friends")
    c = _one(p("swap day 1 and day 2"))
    assert (c.kind, c.day, c.to_day) == ("swap_days", 0, 1)
    c = _one(p("keep day 3 free"))
    assert (c.kind, c.day) == ("clear_day", 2)
    c = _one(p("rename day 2 to Old city"))
    assert (c.kind, c.text) == ("set_theme", "Old city")
    c = _one(p(f"unlock {first}"))
    assert c.kind == "unlock"
    c = _one(p("we're vegetarian now"))
    assert c.diet == "vegetarian"
    c = _one(p("we are 3 people now"))
    assert c.travelers == 3
    c = _one(p("add Panna Meena ka Kund to day 2"))
    assert (c.kind, c.place_name, c.day) == ("add_place", "Panna Meena ka Kund", 1)
    c = _one(p("add a museum on day 2"))
    assert (c.kind, c.interest) == ("add_item", "museum")  # a kind of place, not a name


async def test_multi_step_messages_split_into_changes(ctx):
    itin = plan_heuristic(ctx)
    first = itin.days[0].items[0].name
    r = parse_message(f"remove {first} and add Panna Meena ka Kund to day 3; then make it more relaxed", itin, 40000, "balanced")
    assert [c.kind for c in r.request.changes] == ["remove_item", "add_place", "pace"]
    r = parse_message("swap day 1 and day 2", itin, 40000, "balanced")
    assert [c.kind for c in r.request.changes] == ["swap_days"]  # "and day 2" is not a second instruction


async def test_clarifying_question_then_answer_completes_the_change(ctx):
    from travel_planner.agent.router import complete_pending

    itin = plan_heuristic(ctx)
    r = parse_message("move it to day 3", itin, 40000, "balanced")
    assert r.intent == "clarify" and r.options and r.pending is not None
    done = complete_pending(r.pending, r.options[0], itin)
    assert done and (done.kind, done.place_name, done.to_day) == ("move_item", r.options[0], 2)

    r = parse_message("add a flight at 6pm", itin, 40000, "balanced")
    assert r.intent == "clarify" and r.options[0] == "Day 1"
    done = complete_pending(r.pending, "Day 4", itin)
    assert done and (done.kind, done.day, done.start_min) == ("add_custom", 3, 18 * 60)
    assert complete_pending(r.pending, "never mind", itin) is None


async def test_hours_are_not_rupees(ctx):
    itin = plan_heuristic(ctx)
    r = parse_message("add 2 hours at the spa", itin, 40000, "balanced")
    assert all(c.kind != "budget_delta" for c in r.request.changes)
