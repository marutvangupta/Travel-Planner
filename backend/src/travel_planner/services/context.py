"""PlanContext: everything the deterministic services and the agent need to reason about one trip."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta

from ..schemas import (
    SLOTS,
    Constraints,
    DayWeather,
    Geo,
    GuideChunk,
    Place,
    RouteCell,
    Source,
    TripRequest,
    is_custom_id,
)
from ..tools.common import estimate_leg, haversine_km
from ..tools.demo_data import DESTINATIONS
from ..tools.providers.demo import resolve_key

FOOD_CATS = {"restaurant", "cafe"}
NIGHT_CATS = {"nightlife", "bar", "show"}
SLOT_RANK = {s: i for i, s in enumerate(SLOTS)}
SLOT_EARLIEST = {"morning": 9 * 60, "lunch": 12 * 60 + 30, "afternoon": 14 * 60 + 30, "dinner": 19 * 60, "evening": 20 * 60}
SLOT_LATEST_START = {"morning": 12 * 60, "lunch": 14 * 60 + 30, "afternoon": 18 * 60, "dinner": 21 * 60 + 30, "evening": 22 * 60 + 30}

PACE_SLOTS: dict[str, list[str]] = {
    "relaxed": ["morning", "lunch", "afternoon", "dinner"],
    "balanced": ["morning", "morning", "lunch", "afternoon", "dinner"],
    "packed": ["morning", "morning", "lunch", "afternoon", "afternoon", "dinner", "evening"],
}
PACE_CAP = {"relaxed": 4, "balanced": 5, "packed": 7}


@dataclass
class Entry:
    place_id: str
    slot: str
    why: str = ""
    source_ids: list[str] = field(default_factory=list)
    locked: bool = False
    item_id: str | None = None
    note: str = ""
    fixed_start: int | None = None
    duration_min: int | None = None
    user_set: bool = False

    @property
    def custom(self) -> bool:
        return is_custom_id(self.place_id)


def slot_for_time(minutes: int, *, meal: bool = False) -> str:
    """The slot a clock time falls in. Meals snap to lunch or dinner."""
    if meal:
        return "lunch" if minutes < 17 * 60 else "dinner"
    if minutes < 12 * 60:
        return "morning"
    if minutes < 14 * 60 + 30:
        return "lunch"
    if minutes < 19 * 60:
        return "afternoon"
    if minutes < 21 * 60 + 30:
        return "dinner"
    return "evening"


MEAL_LIKE = {"market", "workshop", "show", "farm", "custom"}  # these serve a meal when tagged "food"


def is_meal(category: str, tags: list[str]) -> bool:
    return category in FOOD_CATS or (category in MEAL_LIKE and "food" in tags)


def is_meal_place(p: Place) -> bool:
    return is_meal(p.category, p.tags)


def slot_ok(p: Place, slot: str) -> bool:
    """Meals only at lunch/dinner; bars and clubs only in the evening slot. Custom entries go anywhere."""
    if is_custom_id(p.place_id):
        return True
    if is_meal_place(p):
        return slot in ("lunch", "dinner")
    if is_nightlife(p):
        return slot == "evening"
    return slot not in ("lunch", "dinner")


def is_nightlife(p: Place) -> bool:
    return p.category in NIGHT_CATS or "nightlife" in p.tags


def transport_for(geo: Geo) -> dict:
    key = resolve_key(geo.name)
    if key:
        return dict(DESTINATIONS[key]["transport"])
    if geo.currency == "INR" or (geo.country or "").lower() == "india":
        return {"kind": "taxi", "base": 50, "per_km": 18}
    return {"kind": "transit", "flat": 180}


@dataclass
class PlanContext:
    request: TripRequest
    constraints: Constraints
    geo: Geo
    places: dict[str, Place]
    matrix: list[list[RouteCell]]
    index: dict[str, int]  # place_id -> matrix index; "__base__" -> 0
    base: tuple[float, float]
    weather: dict[int, DayWeather]
    transport: dict
    weights: dict[str, float] = field(default_factory=dict)
    sources: dict[str, Source] = field(default_factory=dict)
    guides: list[GuideChunk] = field(default_factory=list)
    closed: set[str] = field(default_factory=set)
    data_mode: str = "demo"
    budget: int = 0
    rain_threshold: int = 60
    route_source: str = "estimated"
    extra_ids: set[str] = field(default_factory=set)  # provider places added by name, outside the search pool

    def __post_init__(self) -> None:
        if not self.budget:
            self.budget = self.request.budget_inr

    def register_place(self, p: Place, *, extra: bool = False) -> None:
        """Make a custom entry or a place found by name usable by the scheduler: travel legs to and from it are
        estimated from straight-line distance."""
        self.places[p.place_id] = p
        self.sources[p.source.id] = p.source
        if extra:
            self.extra_ids.add(p.place_id)
        if p.place_id in self.index:
            return
        points: dict[int, tuple[float, float]] = {0: self.base}
        for pid, i in self.index.items():
            if pid != "__base__" and pid in self.places:
                points[i] = (self.places[pid].lat, self.places[pid].lng)
        new_i = len(self.matrix)
        here = (p.lat, p.lng)
        for i, row in enumerate(self.matrix):
            row.append(estimate_leg(points.get(i, self.base), here))
        self.matrix.append([estimate_leg(here, points.get(i, self.base)) for i in range(new_i)]
                           + [estimate_leg(here, here)])
        self.index[p.place_id] = new_i

    # ------------------------------------------------------------------ calendar
    @property
    def interests(self) -> list[str]:
        return self.request.interests or ["culture", "food"]

    def date_for(self, day: int) -> date:
        return self.request.start_date + timedelta(days=day)

    def weekday(self, day: int) -> int:
        return self.date_for(day).weekday()

    def is_rainy(self, day: int) -> bool:
        w = self.weather.get(day)
        return bool(w and w.precip_prob >= self.rain_threshold)

    def is_hot(self, day: int) -> bool:
        w = self.weather.get(day)
        return bool(w and w.condition == "hot")

    # ------------------------------------------------------------------ travel & cost
    def leg(self, a: str | None, b: str) -> RouteCell:
        i = self.index["__base__" if a is None else a]
        return self.matrix[i][self.index[b]]

    def leg_cost(self, cell: RouteCell) -> int:
        if cell.mode == "walk":
            return 0
        t = self.transport
        if t["kind"] == "taxi":
            vehicles = math.ceil(self.request.travelers / 4)
            return round((t["base"] + t["per_km"] * cell.meters / 1000) * vehicles)
        return t["flat"] * self.request.travelers

    def leg_mode_label(self, cell: RouteCell) -> str:
        if cell.mode == "walk":
            return "walk"
        return "taxi" if self.transport["kind"] == "taxi" else "transit"

    def item_cost(self, p: Place) -> int:
        if is_custom_id(p.place_id):
            return p.cost_inr  # the traveller gave a total
        return p.cost_inr * self.request.travelers

    # ------------------------------------------------------------------ scoring
    def score(self, p: Place, *, day: int | None = None, slot: str | None = None) -> float:
        s = 1.4 * len(set(self.interests) & set(p.tags))
        s += ((p.rating or 4.0) - 3.8) * 1.5
        s += 1.2 * sum(self.weights.get(t, 0.0) for t in p.tags) + self.weights.get(p.category, 0.0)
        per_day = self.budget / max(self.request.num_days, 1)
        factor = {"budget": 1.5, "balanced": 1.0, "luxury": 0.3}.get(self.request.travel_style, 1.0)
        s -= min(3.0, 2.0 * self.item_cost(p) / max(per_day, 1)) * factor
        if self.request.travel_style == "luxury" and (p.price_level or 0) >= 3:
            s += 0.5
        if day is not None:
            if self.is_rainy(day):
                s += 1.0 if p.indoor else -4.0
            elif self.is_hot(day) and p.indoor:
                s += 0.4
        if slot == "morning" and not p.indoor:
            s += 0.3
        if slot == "evening" and is_nightlife(p):
            s += 0.8
        if not p.hours:
            s -= 0.3
        s -= 0.025 * haversine_km(self.base[0], self.base[1], p.lat, p.lng)  # day trips must earn their distance
        return s

    def allowed(self, p: Place) -> bool:
        """Hard filters that never depend on the schedule. Custom entries are never planner candidates."""
        c = self.constraints
        if is_custom_id(p.place_id):
            return False
        if p.place_id in self.closed or p.business_status != "OPERATIONAL":
            return False
        avoid = {a.lower() for a in c.avoid}
        if avoid & ({p.category.lower()} | {t.lower() for t in p.tags}):
            return False
        if c.step_free and p.step_free is False:
            return False
        if is_meal_place(p):
            if c.diet == "vegetarian" and "vegetarian" not in p.diet_tags:
                return False
            if c.diet == "vegan" and "vegan" not in p.diet_tags:
                return False
        return True
