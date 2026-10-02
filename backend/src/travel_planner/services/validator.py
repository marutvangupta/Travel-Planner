"""Deterministic feasibility checks. The model proposes a plan; this decides whether it is valid."""

from __future__ import annotations

from ..schemas import Itinerary, Violation
from .context import NIGHT_CATS, PACE_CAP, PlanContext, is_meal

HARD = "error"


def _fmt(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def validate(itin: Itinerary, ctx: PlanContext) -> list[Violation]:
    out: list[Violation] = []
    c = ctx.constraints
    seen: set[str] = set()
    avoid = {a.lower() for a in c.avoid}
    cap = PACE_CAP[ctx.request.pace]

    for day in itin.days:
        wd = ctx.weekday(day.index)
        weather = ctx.weather.get(day.index)
        day_travel = 0
        if len(day.items) > cap:
            out.append(Violation(code="too_many_items", severity="error", day=day.index,
                                 message=f"Day {day.index + 1} has {len(day.items)} stops; a {ctx.request.pace} pace allows {cap}."))
        if not any(is_meal(i.category, i.tags) for i in day.items) and day.items:
            out.append(Violation(code="missing_meal", severity="warning", day=day.index,
                                 message=f"Day {day.index + 1} has no meal stop."))
        for it in day.items:
            p = ctx.places.get(it.place_id)
            if p is None:
                out.append(Violation(code="unknown_place", severity="error", day=day.index, item_id=it.id,
                                     message=f"{it.name} is not in the retrieved place set."))
                continue
            if it.place_id in seen:
                out.append(Violation(code="duplicate", severity="error", day=day.index, item_id=it.id,
                                     message=f"{it.name} appears more than once."))
            seen.add(it.place_id)

            # --- opening hours
            if it.place_id in ctx.closed:
                out.append(Violation(code="marked_closed", severity="error", day=day.index, item_id=it.id,
                                     message=f"{it.name} was marked closed or unavailable."))
            elif p.business_status != "OPERATIONAL":
                out.append(Violation(code="permanently_closed", severity="error", day=day.index, item_id=it.id,
                                     message=f"{it.name} is not operational ({p.business_status})."))
            elif p.hours is None:
                out.append(Violation(code="hours_unverified", severity="warning", day=day.index, item_id=it.id,
                                     message=f"Opening hours for {it.name} could not be verified."))
            else:
                windows = p.hours.get(wd, [])
                if not windows:
                    out.append(Violation(code="closed_day", severity="error", day=day.index, item_id=it.id,
                                         message=f"{it.name} is closed on this day of the week."))
                elif not any(o <= it.start and it.end <= cl for o, cl in windows):
                    shown = ", ".join(f"{_fmt(o)}-{_fmt(cl)}" for o, cl in windows)
                    out.append(Violation(code="closed_at_time", severity="error", day=day.index, item_id=it.id,
                                         message=f"{it.name} is open {shown}; planned {_fmt(it.start)}-{_fmt(it.end)}."))

            # --- day length
            limit = 24 * 60 - 1 if (p.category in NIGHT_CATS or "nightlife" in p.tags) else c.day_end_min
            if it.end > limit:
                out.append(Violation(code="day_overrun", severity="error", day=day.index, item_id=it.id,
                                     message=f"{it.name} ends at {_fmt(it.end)}, after the {_fmt(limit)} cut-off."))

            # --- travel
            if it.travel_from_prev:
                day_travel += it.travel_from_prev.minutes
                if it.travel_from_prev.minutes > c.max_leg_min:
                    out.append(Violation(code="long_leg", severity="warning", day=day.index, item_id=it.id,
                                         message=f"{it.travel_from_prev.minutes} min to reach {it.name}."))

            # --- preferences & constraints
            if avoid & ({p.category.lower()} | {t.lower() for t in p.tags}):
                out.append(Violation(code="avoided_category", severity="error", day=day.index, item_id=it.id,
                                     message=f"{it.name} is in a category you asked to avoid."))
            if c.step_free and p.step_free is False:
                out.append(Violation(code="not_step_free", severity="error", day=day.index, item_id=it.id,
                                     message=f"{it.name} is not step-free accessible."))
            elif c.step_free and p.step_free is None:
                out.append(Violation(code="access_unverified", severity="warning", day=day.index, item_id=it.id,
                                     message=f"Step-free access at {it.name} is unverified."))
            if is_meal(p.category, p.tags):
                if c.diet == "vegetarian" and "vegetarian" not in p.diet_tags:
                    out.append(Violation(code="diet_mismatch", severity="error", day=day.index, item_id=it.id,
                                         message=f"{it.name} has no confirmed vegetarian options."))
                if c.diet == "vegan" and "vegan" not in p.diet_tags:
                    out.append(Violation(code="diet_mismatch", severity="error", day=day.index, item_id=it.id,
                                         message=f"{it.name} has no confirmed vegan options."))

            # --- weather
            if weather and weather.precip_prob >= ctx.rain_threshold and not it.indoor:
                out.append(Violation(code="outdoor_in_rain", severity="error", day=day.index, item_id=it.id,
                                     message=f"{it.name} is outdoors and rain is {weather.precip_prob}% likely."))
            elif weather and weather.condition == "hot" and not it.indoor and 11 * 60 <= it.start <= 16 * 60:
                out.append(Violation(code="heat_exposure", severity="warning", day=day.index, item_id=it.id,
                                     message=f"{it.name} is an outdoor stop in the midday heat ({weather.temp_max:.0f}°C)."))
        if day_travel > 180:
            out.append(Violation(code="heavy_travel_day", severity="warning", day=day.index,
                                 message=f"Day {day.index + 1} spends {day_travel} minutes travelling."))

    if itin.totals.cost_inr > ctx.budget:
        out.append(Violation(code="over_budget", severity="error",
                             message=f"Plan costs ₹{itin.totals.cost_inr:,} against a ₹{ctx.budget:,} budget."))
    return out


def errors(violations: list[Violation]) -> list[Violation]:
    return [v for v in violations if v.severity == HARD]


def summarize(violations: list[Violation]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for v in violations:
        counts[v.code] = counts.get(v.code, 0) + 1
    return counts
