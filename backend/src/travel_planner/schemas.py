"""Shared data contracts. The Itinerary model is the contract the agent, validator, API and UI hang off."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

Pace = Literal["relaxed", "balanced", "packed"]
Slot = Literal["morning", "lunch", "afternoon", "dinner", "evening"]
SLOTS: tuple[str, ...] = ("morning", "lunch", "afternoon", "dinner", "evening")
Diet = Literal["none", "vegetarian", "vegan"]
CustomKind = Literal["meal", "activity", "transport", "lodging", "other"]
CUSTOM_PREFIX = "custom:"


def is_custom_id(place_id: str) -> bool:
    """Entries the traveller created themselves (a flight, a check-in, dinner with friends): not from a provider."""
    return place_id.startswith(CUSTOM_PREFIX)

INTERESTS = [
    "culture", "history", "food", "nature", "adventure",
    "shopping", "nightlife", "relaxation", "art", "architecture",
]

# ----------------------------------------------------------------------------- tool-level models


class Source(BaseModel):
    id: str  # e.g. gplaces:<id>, demo:<id>, guide:<id>, meteo:<lat,lng,date>
    provider: str
    title: str
    url: str | None = None
    retrieved_at: str | None = None


class Geo(BaseModel):
    name: str
    lat: float
    lng: float
    country: str | None = None
    currency: str = "INR"
    source: Source | None = None


# opening hours: weekday (0=Mon..6=Sun) -> list of [open_min, close_min]; None = unknown
Hours = dict[int, list[tuple[int, int]]]


class Place(BaseModel):
    place_id: str
    name: str
    category: str  # fort, museum, restaurant, beach, ...
    tags: list[str] = Field(default_factory=list)  # interests this place serves
    lat: float
    lng: float
    rating: float | None = None
    price_level: int | None = None  # 0 free .. 4 very expensive
    cost_inr: int = 0  # typical per-person spend, INR
    duration_min: int = 60
    indoor: bool = False
    hours: Hours | None = None
    business_status: str = "OPERATIONAL"
    step_free: bool | None = None
    diet_tags: list[str] = Field(default_factory=list)  # vegetarian, vegan, non-veg
    description: str = ""
    area: str | None = None
    source: Source


class DayWeather(BaseModel):
    date: str
    precip_prob: int  # 0-100
    temp_min: float
    temp_max: float
    condition: str  # clear, cloudy, rain, storm, hot
    source: Source | None = None


class RouteCell(BaseModel):
    minutes: int
    meters: int
    mode: str  # walk | taxi | transit


class GuideChunk(BaseModel):
    chunk_id: str
    destination: str
    section: str
    text: str
    url: str | None = None
    provider: str = "curated-demo"
    score: float | None = None


class ToolError(BaseModel):
    error_code: str
    message: str
    retryable: bool = False


# ----------------------------------------------------------------------------- trip request


class Constraints(BaseModel):
    diet: Literal["none", "vegetarian", "vegan"] = "none"
    step_free: bool = False
    avoid: list[str] = Field(default_factory=list)  # categories / interests to avoid
    day_start_min: int = 9 * 60
    day_end_min: int = 22 * 60
    max_leg_min: int = 60
    notes: str = ""


class TripRequest(BaseModel):
    destination: str
    start_date: date
    end_date: date
    budget_inr: int = Field(gt=0)
    travelers: int = Field(default=1, ge=1, le=12)
    interests: list[str] = Field(default_factory=list)
    travel_style: str = "balanced"  # budget | balanced | luxury
    pace: Pace = "balanced"
    constraints_text: str = ""
    diet: Literal["none", "vegetarian", "vegan"] = "none"
    step_free: bool = False
    avoid: list[str] = Field(default_factory=list)
    late_starts: bool = False

    @property
    def num_days(self) -> int:
        return (self.end_date - self.start_date).days + 1


# ----------------------------------------------------------------------------- itinerary


class TravelLeg(BaseModel):
    mode: str
    minutes: int
    meters: int = 0
    cost_inr: int = 0


class Item(BaseModel):
    id: str
    place_id: str
    name: str
    category: str
    tags: list[str] = Field(default_factory=list)
    indoor: bool
    lat: float
    lng: float
    slot: Slot
    start: int  # minutes since midnight
    end: int
    est_cost_inr: int  # total for all travellers
    travel_from_prev: TravelLeg | None = None
    why: str = ""
    source_ids: list[str] = Field(default_factory=list)
    locked: bool = False
    warnings: list[str] = Field(default_factory=list)
    note: str = ""
    fixed_start: int | None = None  # the traveller pinned this start time
    duration_min: int | None = None  # the traveller's override of the usual visit length
    user_set: bool = False  # placed or timed by an explicit request: repair keeps it and warns instead
    custom: bool = False  # a custom entry, not a provider place


class Day(BaseModel):
    index: int
    date: str
    theme: str = ""
    weather: DayWeather | None = None
    items: list[Item] = Field(default_factory=list)
    tip: str | None = None
    tip_source_ids: list[str] = Field(default_factory=list)


class Totals(BaseModel):
    cost_inr: int = 0
    activities_inr: int = 0
    food_inr: int = 0
    transport_inr: int = 0
    travel_minutes: int = 0
    budget_inr: int = 0
    remaining_inr: int = 0
    items: int = 0


class Itinerary(BaseModel):
    destination: str
    base: tuple[float, float] | None = None
    days: list[Day] = Field(default_factory=list)
    totals: Totals = Field(default_factory=Totals)
    assumptions: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    sources: dict[str, Source] = Field(default_factory=dict)
    data_mode: Literal["live", "demo"] = "demo"
    planner: str = "heuristic"  # heuristic | llm
    custom_places: dict[str, Place] = Field(default_factory=dict)  # the traveller's own entries, kept per version
    extra_place_ids: list[str] = Field(default_factory=list)  # provider places added by name outside the search pool

    def all_items(self) -> list[tuple[Day, Item]]:
        return [(d, it) for d in self.days for it in d.items]


# ----------------------------------------------------------------------------- planning IO (LLM output contract)
# No defaults here: OpenAI strict structured outputs requires every field.


class PlanItem(BaseModel):
    place_id: str
    slot: Slot
    why: str
    source_ids: list[str]


class PlanDay(BaseModel):
    day: int  # 0-based
    theme: str
    tip: str
    tip_source_ids: list[str]
    items: list[PlanItem]


class PlanOut(BaseModel):
    days: list[PlanDay]
    assumptions: list[str]


# ----------------------------------------------------------------------------- validation / changes / diff


class Violation(BaseModel):
    code: str
    severity: Literal["error", "warning"]
    message: str
    day: int | None = None
    item_id: str | None = None


ChangeKind = Literal[
    "remove_item", "replace_item", "add_item", "budget_delta", "budget_set", "pace",
    "avoid", "prefer", "weather", "closure", "day_start", "lock",
    # itinerary CRUD
    "add_place", "add_custom", "move_item", "retime_item", "set_duration", "edit_item", "unlock",
    "swap_days", "clear_day", "set_theme", "set_constraints",
]


class Change(BaseModel):
    kind: ChangeKind
    item_id: str | None = None
    place_name: str | None = None  # name mentioned by the user (resolved to an item/place)
    day: int | None = None  # 0-based
    interest: str | None = None
    indoor: bool | None = None
    cheaper: bool | None = None
    amount_inr: int | None = None
    pace: Pace | None = None
    minutes: int | None = None
    note: str | None = None
    place_id: str | None = None  # a specific place to add (from the candidate pool)
    to_day: int | None = None  # 0-based target day for move_item / swap_days
    slot: Slot | None = None
    start_min: int | None = None  # a clock time, minutes since midnight
    duration_min: int | None = None
    text: str | None = None  # note, day theme or the title of a custom entry
    custom_kind: CustomKind | None = None
    diet: Diet | None = None
    step_free: bool | None = None
    travelers: int | None = None


class ChangeRequest(BaseModel):
    changes: list[Change]
    summary: str = ""


class AffectedItem(BaseModel):
    item_id: str
    day: int
    name: str
    reason: str


class ItemChange(BaseModel):
    kind: Literal["added", "removed", "moved", "retimed", "edited"]
    name: str
    place_id: str
    day_from: int | None = None
    day_to: int | None = None
    detail: str = ""


class Diff(BaseModel):
    changes: list[ItemChange] = Field(default_factory=list)
    cost_before: int = 0
    cost_after: int = 0
    cost_delta: int = 0
    travel_before: int = 0
    travel_after: int = 0
    travel_delta: int = 0
    items_before: int = 0
    items_after: int = 0
    stability: float = 1.0  # share of unaffected items that stayed put
    interests_before: dict[str, int] = Field(default_factory=dict)
    interests_after: dict[str, int] = Field(default_factory=dict)
    summary: str = ""


class Proposal(BaseModel):
    version_id: str | None = None
    change_type: str
    reason: str
    affected: list[AffectedItem] = Field(default_factory=list)
    diff: Diff
    itinerary: Itinerary
    violations: list[Violation] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


ChatIntent = Literal["edit", "constraint_change", "whatif", "question", "chitchat", "clarify", "applied", "revert"]


class ChatReply(BaseModel):
    intent: ChatIntent
    reply: str
    proposal: Proposal | None = None
    citations: list[str] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list)  # what the agent did, in order
    options: list[str] = Field(default_factory=list)  # quick replies for a clarifying question
    applied_version_id: str | None = None
