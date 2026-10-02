"""Turn an ordered list of entries into timed items. Pure and deterministic: the LLM never sets clock times."""

from __future__ import annotations

import uuid

from ..schemas import Day, Item, Itinerary, Source, Totals, TravelLeg
from .context import SLOT_EARLIEST, SLOT_RANK, Entry, PlanContext, is_meal, is_meal_place


def new_item_id() -> str:
    return uuid.uuid4().hex[:8]


def schedule_day(
    ctx: PlanContext, day_index: int, entries: list[Entry], *, theme: str = "", tip: str | None = None,
    tip_source_ids: list[str] | None = None,
) -> Day:
    ordered = sorted(entries, key=lambda e: SLOT_RANK[e.slot])  # stable: planner order kept within a slot
    wd = ctx.weekday(day_index)
    clock = ctx.constraints.day_start_min
    prev: str | None = None
    items: list[Item] = []
    for e in ordered:
        p = ctx.places[e.place_id]
        cell = ctx.leg(prev, e.place_id)
        arrival = clock + cell.minutes
        start = max(arrival, SLOT_EARLIEST[e.slot], ctx.constraints.day_start_min)
        windows = (p.hours or {}).get(wd)
        if windows:
            # wait for opening if the next window opens within three hours; leave anything else for the validator
            upcoming = [w for w in windows if w[1] > start]
            if upcoming:
                w = upcoming[0]
                if start < w[0] and w[0] - start <= 180:
                    start = w[0]
        end = start + p.duration_min
        items.append(Item(
            id=e.item_id or new_item_id(), place_id=p.place_id, name=p.name, category=p.category, tags=list(p.tags),
            indoor=p.indoor, lat=p.lat, lng=p.lng, slot=e.slot, start=start, end=end,
            est_cost_inr=ctx.item_cost(p),
            travel_from_prev=TravelLeg(mode=ctx.leg_mode_label(cell), minutes=cell.minutes, meters=cell.meters,
                                       cost_inr=ctx.leg_cost(cell)),
            why=e.why, source_ids=list(e.source_ids), locked=e.locked,
        ))
        clock = end
        prev = e.place_id
    return Day(
        index=day_index, date=ctx.date_for(day_index).isoformat(), theme=theme, weather=ctx.weather.get(day_index),
        items=items, tip=tip, tip_source_ids=tip_source_ids or [],
    )


def entries_from_day(day: Day) -> list[Entry]:
    return [Entry(place_id=i.place_id, slot=i.slot, why=i.why, source_ids=list(i.source_ids), locked=i.locked,
                  item_id=i.id) for i in day.items]


def compute_totals(ctx: PlanContext, days: list[Day]) -> Totals:
    t = Totals(budget_inr=ctx.budget)
    for d in days:
        for it in d.items:
            t.items += 1
            if is_meal(it.category, it.tags):
                t.food_inr += it.est_cost_inr
            else:
                t.activities_inr += it.est_cost_inr
            if it.travel_from_prev:
                t.transport_inr += it.travel_from_prev.cost_inr
                t.travel_minutes += it.travel_from_prev.minutes
    t.cost_inr = t.food_inr + t.activities_inr + t.transport_inr
    t.remaining_inr = ctx.budget - t.cost_inr
    return t


def collect_sources(ctx: PlanContext, days: list[Day]) -> dict[str, Source]:
    out: dict[str, Source] = {}
    for d in days:
        for it in d.items:
            for sid in it.source_ids:
                if sid in ctx.sources:
                    out[sid] = ctx.sources[sid]
            p = ctx.places.get(it.place_id)
            if p:
                out[p.source.id] = p.source
        for sid in d.tip_source_ids:
            if sid in ctx.sources:
                out[sid] = ctx.sources[sid]
        if d.weather and d.weather.source:
            out[d.weather.source.id] = d.weather.source
    return out


def assemble(ctx: PlanContext, days: list[Day], *, assumptions: list[str] | None = None,
             planner: str = "heuristic", warnings: list[str] | None = None) -> Itinerary:
    base_assumptions = [
        "Budget covers activities, food and local transport for all travellers. It excludes flights and lodging.",
        "Costs are typical per-person estimates multiplied by the number of travellers.",
    ]
    if ctx.route_source == "estimated":
        base_assumptions.append("Travel times are estimated from straight-line distance; add a Google Maps key for live routing.")
    if any(d.weather and d.weather.source and d.weather.source.provider == "synthetic-climatology" for d in days):
        base_assumptions.append("Weather beyond the 16-day forecast window uses synthetic climatology, not a real forecast.")
    return Itinerary(
        destination=ctx.geo.name, base=ctx.base, days=days, totals=compute_totals(ctx, days),
        assumptions=base_assumptions + (assumptions or []), warnings=warnings or [],
        sources=collect_sources(ctx, days), data_mode=ctx.data_mode, planner=planner,  # type: ignore[arg-type]
    )


def rebuild(ctx: PlanContext, itin: Itinerary, day_entries: dict[int, list[Entry]]) -> Itinerary:
    """Re-schedule the given days (others kept as-is) and recompute totals."""
    days: list[Day] = []
    for d in itin.days:
        if d.index in day_entries:
            days.append(schedule_day(ctx, d.index, day_entries[d.index], theme=d.theme, tip=d.tip,
                                     tip_source_ids=d.tip_source_ids))
        else:
            days.append(d.model_copy(deep=True))
    out = itin.model_copy(deep=True)
    out.days = days
    out.totals = compute_totals(ctx, days)
    out.sources = collect_sources(ctx, days)
    return out


def meal_count(day: Day) -> int:
    return sum(1 for i in day.items if is_meal(i.category, i.tags))


__all__ = [
    "assemble", "collect_sources", "compute_totals", "entries_from_day", "is_meal_place", "meal_count",
    "new_item_id", "rebuild", "schedule_day",
]
