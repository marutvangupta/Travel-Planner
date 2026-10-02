"""Deterministic planner. It is the offline fallback, the baseline the LLM planner is evaluated against,
and the source of replacement candidates during re-planning."""

from __future__ import annotations

from ..schemas import Day, Itinerary, Place
from ..tools.common import haversine_km
from .context import (
    PACE_SLOTS,
    Entry,
    PlanContext,
    is_meal_place,
    is_nightlife,
    slot_ok,
)
from .scheduler import assemble, schedule_day
from .validator import errors, validate

SECTION_BY_THEME = {
    "history": "See", "architecture": "See", "culture": "See", "art": "See", "nature": "When to go",
    "food": "Eat", "shopping": "Buy", "nightlife": "Stay safe", "adventure": "Stay safe", "relaxation": "Get around",
}


def make_why(ctx: PlanContext, p: Place, day: int) -> str:
    bits: list[str] = []
    matched = [t for t in p.tags if t in ctx.interests]
    if matched:
        bits.append(f"Matches your interest in {', '.join(matched[:2])}")
    elif is_meal_place(p):
        bits.append("A good meal stop on the route")
    else:
        bits.append("Adds variety to the day")
    if p.rating:
        bits.append(f"rated {p.rating:.1f}")
    if ctx.is_rainy(day) and p.indoor:
        bits.append("indoors for the rain forecast")
    if p.description:
        bits.append(p.description.rstrip("."))
    return "; ".join(bits[:3]) + "."


def _tip_for(ctx: PlanContext, day: int, themes: list[str], used: set[str]) -> tuple[str | None, list[str]]:
    if not ctx.guides:
        return None, []
    wanted: list[str] = []
    if day == 0:
        wanted.append("Get around")
    wanted += [SECTION_BY_THEME.get(t, "See") for t in themes]
    if day == ctx.request.num_days - 1:
        wanted.append("Stay safe")
    for section in wanted:
        for g in ctx.guides:
            if g.section == section and g.chunk_id not in used:
                used.add(g.chunk_id)
                text = g.text if len(g.text) <= 230 else g.text[:227].rsplit(" ", 1)[0] + "…"
                return text, [f"guide:{g.chunk_id}"]
    for g in ctx.guides:
        if g.chunk_id not in used:
            used.add(g.chunk_id)
            return (g.text if len(g.text) <= 230 else g.text[:227].rsplit(" ", 1)[0] + "…"), [f"guide:{g.chunk_id}"]
    return None, []


def _day_center(ctx: PlanContext, entries: list[Entry]) -> tuple[float, float]:
    pts = [(ctx.places[e.place_id].lat, ctx.places[e.place_id].lng) for e in entries]
    if not pts:
        return ctx.base
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def _day_error_keys(ctx: PlanContext, day: Day) -> set[tuple[str, str]]:
    itin = Itinerary(destination=ctx.geo.name, days=[day])
    id2place = {i.id: i.place_id for i in day.items}
    return {
        (v.code, id2place.get(v.item_id or "", ""))
        for v in validate(itin, ctx) if v.severity == "error" and v.code != "over_budget"
    }


def _tentatively_ok(ctx: PlanContext, day: int, entries: list[Entry], new: Entry) -> bool:
    """Adding `new` must not introduce any hard violation in this day (including knock-on effects such as
    pushing a later stop past its closing time)."""
    trial = schedule_day(ctx, day, entries + [new])
    base = schedule_day(ctx, day, entries)
    return not (_day_error_keys(ctx, trial) - _day_error_keys(ctx, base))


def candidate_pool(ctx: PlanContext, exclude: set[str]) -> list[Place]:
    return [p for p in ctx.places.values() if p.place_id not in exclude and ctx.allowed(p)]


def plan_heuristic(ctx: PlanContext) -> Itinerary:
    req = ctx.request
    n_days = req.num_days
    slots = list(PACE_SLOTS[req.pace])
    used: set[str] = set()
    spent = 0
    day_entries: dict[int, list[Entry]] = {d: [] for d in range(n_days)}
    pool = candidate_pool(ctx, used)
    min_meal = min((ctx.item_cost(p) for p in pool if is_meal_place(p)), default=0)

    # rainy days pick first so they can claim the limited indoor places
    order = sorted(range(n_days), key=lambda d: (not ctx.is_rainy(d), d))
    for pos, d in enumerate(order):
        entries = day_entries[d]
        day_spent = 0
        # soft daily cap: spread what is left evenly over the days still to plan (10% slack, 10% kept for transport)
        per_day = max(ctx.budget * 0.9 - spent, 0) / (n_days - pos)
        night_day = "nightlife" in ctx.interests and d % 2 == 1
        day_slots = list(slots)
        if night_day and "afternoon" in day_slots and "evening" not in day_slots:
            day_slots[len(day_slots) - 1 - day_slots[::-1].index("afternoon")] = "evening"
        anchor: Place | None = None
        for slot in day_slots:
            remaining_meals = sum(1 for s in day_slots[day_slots.index(slot) + 1:] if s in ("lunch", "dinner"))
            reserve = remaining_meals * min_meal
            meal_slot = slot in ("lunch", "dinner")
            candidates = [p for p in candidate_pool(ctx, used) if slot_ok(p, slot)]
            if slot == "evening":
                candidates = [p for p in candidates if is_nightlife(p)] or candidates
            center = _day_center(ctx, entries) if entries else ctx.base
            ranked = []
            for p in candidates:
                dist = haversine_km(center[0], center[1], p.lat, p.lng)
                far = 0.2 * dist if anchor or meal_slot else 0.0
                ranked.append((ctx.score(p, day=d, slot=slot) - far, p))
            ranked.sort(key=lambda t: -t[0])
            picked = False
            for pass_no in (0, 1):
                if picked or (pass_no == 1 and not meal_slot):
                    break
                # pass 0 respects the daily cap; pass 1 (meals only) takes the cheapest feasible option
                order_p = [p for _, p in ranked] if pass_no == 0 else sorted(
                    (p for _, p in ranked), key=lambda q: ctx.item_cost(q))
                for p in order_p:
                    cost = ctx.item_cost(p)
                    if spent + cost + reserve > ctx.budget * 0.9:
                        continue
                    if pass_no == 0 and day_spent + cost + remaining_meals * min_meal > per_day * 1.1:
                        continue
                    entry = Entry(place_id=p.place_id, slot=slot, why=make_why(ctx, p, d), source_ids=[p.source.id])
                    if _tentatively_ok(ctx, d, entries, entry):
                        entries.append(entry)
                        used.add(p.place_id)
                        spent += cost
                        day_spent += cost
                        anchor = anchor or p
                        picked = True
                        break

    tip_used: set[str] = set()
    days: list[Day] = []
    for d in range(n_days):
        themes = _themes(ctx, day_entries[d])
        tip, tip_src = _tip_for(ctx, d, themes, tip_used)
        theme = " & ".join(t.title() for t in themes[:2]) or "Open day"
        days.append(schedule_day(ctx, d, day_entries[d], theme=theme, tip=tip, tip_source_ids=tip_src))
    itin = assemble(ctx, days, planner="heuristic")
    light = [d.index + 1 for d in days if len(d.items) < 3]
    if light:
        itin.warnings.append(
            f"Day{'s' if len(light) > 1 else ''} {', '.join(map(str, light))} {'are' if len(light) > 1 else 'is'} light: "
            f"the budget or the available places could not support more stops. Raising the budget would add more.")
    return itin


def _themes(ctx: PlanContext, entries: list[Entry]) -> list[str]:
    counts: dict[str, int] = {}
    for e in entries:
        p = ctx.places[e.place_id]
        for t in p.tags:
            if t in ctx.interests or t not in ("food",):
                counts[t] = counts.get(t, 0) + (2 if t in ctx.interests else 1)
    return [t for t, _ in sorted(counts.items(), key=lambda kv: -kv[1])][:3]


def itinerary_errors(ctx: PlanContext, itin: Itinerary):  # noqa: ANN201
    return errors(validate(itin, ctx))
