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
