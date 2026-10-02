"""Impact analysis and partial re-planning.

analyze_impact(): turn a ChangeRequest into concrete actions and the list of affected items (rules, no LLM).
Editor.run(): apply the actions to only the affected slots; everything else keeps its place (locked in effect).
repair(): bounded deterministic fix-up so the final itinerary has no hard violations. Stops the traveller placed
or timed explicitly (user_set) are never moved by repair: their problems are reported as warnings instead.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..schemas import (
    CUSTOM_PREFIX,
    SLOTS,
    AffectedItem,
    Change,
    ChangeRequest,
    DayWeather,
    Diff,
    Itinerary,
    Place,
    Source,
    Violation,
    is_custom_id,
)
from ..tools.common import haversine_km, now_iso
from .context import (
    PACE_CAP,
    SLOT_EARLIEST,
    Entry,
    PlanContext,
    is_meal_place,
    is_nightlife,
    slot_for_time,
    slot_ok,
)
from .diff import diff_itineraries
from .embeddings import tokenize
from .planner import _day_error_keys, _tentatively_ok, make_why
from .scheduler import compute_totals, entries_from_day, new_item_id, rebuild, schedule_day
from .validator import errors, validate

CUSTOM_DURATION = {"transport": 120, "lodging": 30, "meal": 90, "activity": 90, "other": 60}
CUSTOM_DEFAULT_START = {"transport": 18 * 60, "lodging": 14 * 60, "meal": 20 * 60, "activity": 11 * 60, "other": 12 * 60}

# ----------------------------------------------------------------------------- lookup helpers


def find_item(itin: Itinerary, item_id: str):  # noqa: ANN201
    for d, it in itin.all_items():
        if it.id == item_id:
            return d, it
    return None


def resolve_item(itin: Itinerary, change: Change):  # noqa: ANN201
    if change.item_id:
        hit = find_item(itin, change.item_id)
        if hit:
            return hit
    name = (change.place_name or "").strip().lower()
    if not name:
        return None
    qt = set(tokenize(name))
    best, best_score = None, 0.0
    for d, it in itin.all_items():
        if change.day is not None and d.index != change.day:
            continue
        nm = it.name.lower()
        if name in nm or nm in name:
            score = 1.0
        else:
            toks = set(tokenize(nm))
            score = len(qt & toks) / max(len(qt), 1) if qt else 0.0
        if score > best_score:
            best, best_score = (d, it), score
    return best if best_score >= 0.5 else None


GENERIC_PLACE_WORDS = {
    "palace", "fort", "museum", "temple", "market", "bazaar", "restaurant", "cafe", "garden", "gardens", "lake", "beach",
    "mahal", "hotel", "park", "gallery", "church", "mosque", "tower", "bar", "club", "street", "road", "house", "hall",
    "point", "viewpoint", "the", "of", "and", "old", "new", "city", "art", "food", "court", "centre", "center", "village",
}
GENERIC_PLACE_TOKENS = set(tokenize(" ".join(GENERIC_PLACE_WORDS)))


def resolve_place(ctx: PlanContext, name: str | None) -> Place | None:
    """A provider place in the trip's candidate pool, by name. Fuzzy matches must share a distinctive word
    ("Hawa" in "Hawa Mahal"), so "Imaginary Palace" never resolves to a real palace."""
    q = (name or "").strip().lower()
    if not q:
        return None
    qt = {t for t in tokenize(q) if t not in GENERIC_PLACE_TOKENS}
    best, best_score = None, 0.0
    for p in ctx.places.values():
        if is_custom_id(p.place_id):
            continue
        nm = p.name.lower()
        key = re.sub(r"\(.*?\)", "", nm).strip()
        if q in (nm, key):
            score = 3.0
        elif q in nm or (len(key) >= 4 and key in q):
            score = 2.0 + len(key) / 1000
        elif qt:
            toks = set(tokenize(nm))
            score = len(qt & toks) / len(qt)
        else:
            score = 0.0
        if score > best_score:
            best, best_score = p, score
    return best if best_score >= 0.5 else None


def make_custom_place(ctx: PlanContext, title: str, kind: str = "other", *, cost_inr: int | None = None,
                      duration_min: int | None = None, near: Place | None = None) -> Place:
    """A traveller-defined entry (flight, check-in, dinner with friends). It sits at a named place when one was
    given, otherwise at the trip base, so travel to it is an estimate."""
    pid = f"{CUSTOM_PREFIX}{new_item_id()}"
    lat, lng = (near.lat, near.lng) if near else ctx.base
    return Place(
        place_id=pid, name=(title.strip()[:80] or "Your entry"), category="custom",
        tags=[kind, "food"] if kind == "meal" else [kind], lat=lat, lng=lng, cost_inr=max(int(cost_inr or 0), 0),
        duration_min=duration_min or CUSTOM_DURATION.get(kind, 60), indoor=True, hours=None,
        description=f"At {near.name}" if near else "", area=near.name if near else None,
        source=Source(id=f"user:{pid[len(CUSTOM_PREFIX):]}", provider="you", title="Added by you"),
    )


def slot_near(p: Place, minutes: int) -> str:
    """A slot this place may use, close to a clock time."""
    if is_custom_id(p.place_id):
        return slot_for_time(minutes, meal="food" in p.tags)
    if is_meal_place(p):
        return slot_for_time(minutes, meal=True)
    if is_nightlife(p):
        return "evening"
    s = slot_for_time(minutes)
    if slot_ok(p, s):
        return s
    return "morning" if minutes < 13 * 60 + 15 else ("afternoon" if minutes < 20 * 60 else "evening")


def item_errors(ctx: PlanContext, day: int, entries: list[Entry], item_id: str | None) -> set[str]:
    """Hard violations that one entry has within its day."""
    sched = schedule_day(ctx, day, entries)
    itin = Itinerary(destination=ctx.geo.name, days=[sched])
    return {v.code for v in validate(itin, ctx) if v.severity == "error" and v.item_id == item_id
            and v.code not in ("too_many_items", "over_budget")}


def day_entries_map(itin: Itinerary) -> dict[int, list[Entry]]:
    return {d.index: entries_from_day(d) for d in itin.days}


# ----------------------------------------------------------------------------- impact analysis


@dataclass
class Action:
    kind: str  # replace | remove | add | reduce_budget | pace | reschedule | lock
    item_id: str | None = None
    day: int | None = None
    indoor: bool | None = None
    cheaper: bool = False
    interest: str | None = None
    target: int | None = None
    pace: str | None = None
    reason: str = ""
    explicit: bool = False  # user named this item, so locks do not protect it
    preferred: str | None = None  # place_id suggested by the LLM from the feasible shortlist
    place_id: str | None = None
    to_day: int | None = None
    slot: str | None = None
    start: int | None = None
    minutes: int | None = None
    text: str | None = None
    cost: int | None = None
    custom_kind: str | None = None
    near_id: str | None = None
    locked: bool | None = None
    drop_if_stuck: bool = False  # remove the stop when no feasible replacement exists


@dataclass
class ImpactPlan:
    actions: list[Action] = field(default_factory=list)
    affected: list[AffectedItem] = field(default_factory=list)
    request_patch: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def _affect(plan: ImpactPlan, day, item, reason: str) -> None:  # noqa: ANN001
    if not any(a.item_id == item.id for a in plan.affected):
        plan.affected.append(AffectedItem(item_id=item.id, day=day.index, name=item.name, reason=reason))


def analyze_impact(ctx: PlanContext, itin: Itinerary, cr: ChangeRequest) -> ImpactPlan:
    plan = ImpactPlan()
    for ch in cr.changes:
        k = ch.kind
        if k == "remove_item":
            hit = resolve_item(itin, ch)
            if not hit:
                plan.notes.append(f"I could not find “{ch.place_name or ch.item_id}” in the itinerary.")
                continue
            d, it = hit
            _affect(plan, d, it, "You asked to remove it")
            plan.actions.append(Action("remove", item_id=it.id, explicit=True, reason="You asked to remove it"))
        elif k == "replace_item":
            hit = resolve_item(itin, ch)
            if not hit:
                plan.notes.append(f"I could not find “{ch.place_name or ch.item_id}” in the itinerary.")
                continue
            d, it = hit
            why = "You asked to swap it" + (f" for something {ch.interest}" if ch.interest else "")
            _affect(plan, d, it, why)
            plan.actions.append(Action("replace", item_id=it.id, indoor=ch.indoor, cheaper=bool(ch.cheaper),
                                       interest=ch.interest, explicit=True, reason=why,
                                       preferred=ch.place_id if ch.place_id in ctx.places else None))
        elif k == "add_item":
            plan.actions.append(Action("add", day=ch.day, interest=ch.interest, reason=ch.note or "You asked to add something"))
        elif k in ("budget_delta", "budget_set"):
            current = ctx.budget
            new = ch.amount_inr if k == "budget_set" else current + (ch.amount_inr or 0)
            new = max(int(new or 0), 1)
            ctx.budget = new
            plan.request_patch["budget_inr"] = new
            if new < current:
                plan.actions.append(Action("reduce_budget", target=new, reason=f"Budget is now ₹{new:,}"))
                plan.notes.append(f"__budget_check__:{new}")  # replaced with a plain-language note once totals are known
            else:
                # a bigger budget buys more: add the best-fitting extra stops
                for _ in range(2):
                    plan.actions.append(Action("add", reason=f"Budget is now ₹{new:,}, which leaves room for more"))
        elif k == "pace":
            plan.request_patch["pace"] = ch.pace
            plan.actions.append(Action("pace", pace=ch.pace, reason=f"Pace changed to {ch.pace}"))
        elif k == "avoid":
            term = (ch.interest or ch.place_name or "").lower()
            if not term:
                continue
            ctx.constraints.avoid = sorted(set(ctx.constraints.avoid) | {term})
            plan.request_patch["avoid"] = list(ctx.constraints.avoid)
            for d, it in itin.all_items():
                if not it.custom and term in {it.category.lower(), *[t.lower() for t in it.tags]}:
                    why = f"You want to avoid {term}"
                    _affect(plan, d, it, why)
                    plan.actions.append(Action("replace", item_id=it.id, reason=why, explicit=True))
        elif k == "prefer":
            term = (ch.interest or "").lower()
            if term:
                ctx.weights[term] = min(1.0, ctx.weights.get(term, 0.0) + 0.5)
                if term not in ctx.interests:
                    ctx.request.interests = [*ctx.request.interests, term]
                    plan.request_patch["interests"] = list(ctx.request.interests)
                n = max(1, min(2, ctx.request.num_days))
                for _ in range(n):
                    plan.actions.append(Action("add", interest=term, reason=f"You want more {term}"))
        elif k == "weather":
            days = [ch.day] if ch.day is not None else [d for d in range(ctx.request.num_days) if ctx.is_rainy(d)]
            if not days:
                plan.notes.append("No rainy days are forecast, so nothing needs to change.")
            for di in days:
                if ch.day is not None:  # simulated override
                    ctx.weather[di] = DayWeather(
                        date=ctx.date_for(di).isoformat(), precip_prob=85, temp_min=20, temp_max=26, condition="rain",
                        source=Source(id=f"meteo:sim:{di}", provider="simulated", title="Simulated rain",
                                      retrieved_at=now_iso()),
                    )
                day = next((x for x in itin.days if x.index == di), None)
                if not day:
                    continue
                if all(it.indoor for it in day.items):
                    plan.notes.append(f"Day {di + 1} already has only indoor stops, so rain does not change it.")
                for it in day.items:
                    if not it.indoor:
                        why = f"Rain is {ctx.weather[di].precip_prob}% likely on day {di + 1}"
                        _affect(plan, day, it, why)
                        plan.actions.append(Action("replace", item_id=it.id, indoor=True, reason=why))
        elif k == "closure":
            hit = resolve_item(itin, ch)
            if hit:
                d, it = hit
                ctx.closed.add(it.place_id)
                why = f"{it.name} is closed or unavailable"
                _affect(plan, d, it, why)
                plan.actions.append(Action("replace", item_id=it.id, reason=why, explicit=True))
            else:
                plan.notes.append(f"I could not find “{ch.place_name}” in the itinerary.")
        elif k == "day_start":
            minutes = ch.minutes or 10 * 60 + 30
            ctx.constraints.day_start_min = minutes
            plan.request_patch["late_starts"] = True
            plan.actions.append(Action("reschedule", reason=f"Days now start at {minutes // 60:02d}:{minutes % 60:02d}"))
        elif k in ("lock", "unlock"):
            hit = resolve_item(itin, ch)
            if hit:
                plan.actions.append(Action("lock", item_id=hit[1].id, locked=k == "lock"))
            else:
                plan.notes.append(f"I could not find “{ch.place_name or ch.item_id}” in the itinerary.")
        else:
            _crud_impact(ctx, itin, ch, plan)
    if ctx.closed:
        plan.request_patch["_closed"] = sorted(ctx.closed)
    return plan


def _day_ok(itin: Itinerary, day: int | None, plan: ImpactPlan) -> bool:
    if day is None or not 0 <= day < len(itin.days):
        n = len(itin.days)
        plan.notes.append(f"This trip has {n} day{'s' if n != 1 else ''}; tell me which one (1 to {n})." if day is not None
                          else "Which day? Tell me the day number.")
        return False
    return True


def _hit(itin: Itinerary, ch: Change, plan: ImpactPlan):  # noqa: ANN202
    hit = resolve_item(itin, ch)
    if not hit:
        plan.notes.append(f"I could not find “{ch.place_name or ch.item_id or 'that stop'}” in the itinerary.")
    return hit


def _crud_impact(ctx: PlanContext, itin: Itinerary, ch: Change, plan: ImpactPlan) -> None:
    """Itinerary CRUD changes: add a named place or a custom entry, move, retime, resize, annotate, day edits."""
    k = ch.kind
    if k == "add_place":
        p = ctx.places.get(ch.place_id) if ch.place_id else None
        if p is None or is_custom_id(p.place_id):
            p = resolve_place(ctx, ch.place_name)
        if p is None:
            if ch.interest:
                plan.actions.append(Action("add", day=ch.day, interest=ch.interest, reason=f"You asked for {ch.interest}"))
            else:
                plan.notes.append(f"I could not find “{ch.place_name or ch.place_id}” among the places I know in {ctx.geo.name}.")
            return
        if ch.day is not None and not _day_ok(itin, ch.day, plan):
            return
        present = next(((d, it) for d, it in itin.all_items() if it.place_id == p.place_id), None)
        if present:
            d, it = present
            if (ch.day is not None and ch.day != d.index) or ch.slot or ch.start_min is not None:
                why = f"You asked for {it.name}" + (f" on day {ch.day + 1}" if ch.day is not None else "")
                _affect(plan, d, it, why)
                plan.actions.append(Action("move", item_id=it.id, to_day=ch.day, slot=ch.slot, start=ch.start_min,
                                           reason=why, explicit=True))
            else:
                plan.notes.append(f"{p.name} is already on day {d.index + 1}.")
            return
        plan.actions.append(Action("add_place", place_id=p.place_id, day=ch.day, slot=ch.slot, start=ch.start_min,
                                   reason=f"You asked to add {p.name}", explicit=True))
    elif k == "add_custom":
        title = (ch.text or ch.place_name or "").strip()
        if not title:
            plan.notes.append("What should I call this entry? For example “Flight to Mumbai at 18:00 on day 4”.")
            return
        day = ch.day if ch.day is not None else 0
        if not _day_ok(itin, day, plan):
            return
        near = resolve_place(ctx, ch.place_name) if ch.place_name and ch.text else None
        plan.actions.append(Action("add_custom", day=day, start=ch.start_min, minutes=ch.duration_min, text=title,
                                   cost=ch.amount_inr, custom_kind=ch.custom_kind or "other",
                                   near_id=near.place_id if near else None, reason=ch.note or "Added by you"))
    elif k in ("move_item", "retime_item"):
        hit = _hit(itin, ch, plan)
        if not hit:
            return
        d, it = hit
        to_day = ch.to_day if k == "move_item" else None
        if to_day is not None and not _day_ok(itin, to_day, plan):
            return
        if to_day is None and ch.slot is None and ch.start_min is None:
            plan.notes.append(f"Where should {it.name} go? Give a day, a part of the day or a time.")
            return
        when = []
        if to_day is not None and to_day != d.index:
            when.append(f"day {to_day + 1}")
        if ch.start_min is not None:
            when.append(f"{ch.start_min // 60:02d}:{ch.start_min % 60:02d}")
        elif ch.slot:
            when.append(f"the {ch.slot}")
        why = f"You asked to move it to {' at '.join(when) or 'a new time'}"
        _affect(plan, d, it, why)
        plan.actions.append(Action("move", item_id=it.id, to_day=to_day, slot=ch.slot, start=ch.start_min, reason=why,
                                   explicit=True))
    elif k == "set_duration":
        hit = _hit(itin, ch, plan)
        minutes = ch.duration_min or ch.minutes
        if not hit:
            return
        if not minutes:
            plan.notes.append(f"How long should {hit[1].name} take?")
            return
        d, it = hit
        why = f"You asked for {minutes // 60}h{minutes % 60:02d} there"
        _affect(plan, d, it, why)
        plan.actions.append(Action("duration", item_id=it.id, minutes=minutes, reason=why, explicit=True))
    elif k == "edit_item":
        hit = _hit(itin, ch, plan)
        if not hit:
            return
        d, it = hit
        if ch.text is None and ch.amount_inr is None:
            plan.notes.append(f"What should I change about {it.name}? I can add a note or, for your own entries, a cost.")
            return
        _affect(plan, d, it, "You edited it")
        plan.actions.append(Action("edit", item_id=it.id, text=ch.text, cost=ch.amount_inr, reason="You edited it"))
    elif k == "swap_days":
        a, b = ch.day, ch.to_day
        if not (_day_ok(itin, a, plan) and _day_ok(itin, b, plan)) or a == b:
            if a == b and a is not None:
                plan.notes.append("Those are the same day.")
            return
        why = f"You swapped day {a + 1} and day {b + 1}"
        for d in (itin.days[a], itin.days[b]):
            for it in d.items:
                if not (it.locked or it.custom):
                    _affect(plan, d, it, why)
        plan.actions.append(Action("swap_days", day=a, to_day=b, reason=why, explicit=True))
    elif k == "clear_day":
        if not _day_ok(itin, ch.day, plan):
            return
        d = itin.days[ch.day]
        why = f"You cleared day {ch.day + 1}"
        for it in d.items:
            if not (it.locked or it.custom):
                _affect(plan, d, it, why)
        plan.actions.append(Action("clear_day", day=ch.day, reason=why, explicit=True))
    elif k == "set_theme":
        if not _day_ok(itin, ch.day, plan) or not (ch.text or "").strip():
            return
        plan.actions.append(Action("theme", day=ch.day, text=(ch.text or "").strip()[:60]))
    elif k == "set_constraints":
        if ch.diet and ch.diet != ctx.constraints.diet:
            ctx.constraints.diet = ch.diet
            ctx.request.diet = ch.diet
            plan.request_patch["diet"] = ch.diet
            why = f"Your diet is now {ch.diet}" if ch.diet != "none" else "Diet restriction removed"
            for d, it in itin.all_items():
                p = ctx.places.get(it.place_id)
                if p and not it.custom and is_meal_place(p) and ch.diet != "none" and ch.diet not in p.diet_tags:
                    _affect(plan, d, it, why)
                    plan.actions.append(Action("replace", item_id=it.id, reason=why, explicit=True, drop_if_stuck=True))
        if ch.step_free is not None and ch.step_free != ctx.constraints.step_free:
            ctx.constraints.step_free = ch.step_free
            ctx.request.step_free = ch.step_free
            plan.request_patch["step_free"] = ch.step_free
            if ch.step_free:
                why = "You need step-free access"
                for d, it in itin.all_items():
                    p = ctx.places.get(it.place_id)
                    if p and not it.custom and p.step_free is False:
                        _affect(plan, d, it, why)
                        plan.actions.append(Action("replace", item_id=it.id, reason=why, explicit=True, drop_if_stuck=True))
        if ch.travelers and ch.travelers != ctx.request.travelers:
            n = max(1, min(int(ch.travelers), 12))
            ctx.request.travelers = n
            plan.request_patch["travelers"] = n
            plan.actions.append(Action("reschedule", reason=f"Costs now cover {n} traveller{'s' if n > 1 else ''}"))
            plan.notes.append(f"Costs now cover {n} traveller{'s' if n > 1 else ''}.")


# ----------------------------------------------------------------------------- executor


class Editor:
    def __init__(self, ctx: PlanContext, itin: Itinerary) -> None:
        self.ctx = ctx
        self.base = itin
        self.itin = itin
        self.entries = day_entries_map(itin)
        self.affected: dict[str, AffectedItem] = {}
        self.notes: list[str] = []
        self.meta: dict[int, dict] = {}  # day theme / tip overrides
        self.protect: set[str] = set()  # placed by this request: repair warns instead of undoing it
        self._orig = {it.id: (d.index, it) for d, it in itin.all_items()}

    # -- state helpers
    def used(self) -> set[str]:
        return {e.place_id for es in self.entries.values() for e in es}

    def locate(self, item_id: str) -> tuple[int, Entry] | None:
        for d, es in self.entries.items():
            for e in es:
                if e.item_id == item_id:
                    return d, e
        return None

    def scheduled(self):  # noqa: ANN201
        return [schedule_day(self.ctx, d, es) for d, es in sorted(self.entries.items())]

    def total_cost(self) -> int:
        return compute_totals(self.ctx, self.scheduled()).cost_inr

    def stops(self, day: int) -> int:
        """Stops that count toward the pace cap (the traveller's own entries do not)."""
        return sum(1 for e in self.entries[day] if not e.custom)

    def mark(self, item_id: str | None, reason: str) -> None:
        if item_id and item_id in self._orig and item_id not in self.affected:
            day, it = self._orig[item_id]
            self.affected[item_id] = AffectedItem(item_id=item_id, day=day, name=it.name, reason=reason)

    # -- candidate search
    def candidates(self, day: int, slot: str, others: list[Entry], *, indoor: bool | None = None,
                   max_cost: int | None = None, interest: str | None = None) -> list[Place]:
        ctx, used = self.ctx, self.used()
        meal_slot = slot in ("lunch", "dinner")
        pts = [(ctx.places[e.place_id].lat, ctx.places[e.place_id].lng) for e in others]
        center = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) if pts else ctx.base
        ranked: list[tuple[float, Place]] = []
        for p in ctx.places.values():
            if p.place_id in used or not ctx.allowed(p):
                continue
            if meal_slot and not is_meal_place(p):
                continue
            if not meal_slot and is_meal_place(p) and interest != "food":
                continue
            if not slot_ok(p, slot) and not (interest == "food" and is_meal_place(p)):
                continue
            if indoor is not None and p.indoor != indoor:
                continue
            if max_cost is not None and ctx.item_cost(p) > max_cost:
                continue
            if interest and interest not in p.tags and p.category != interest:
                continue
            ranked.append((ctx.score(p, day=day, slot=slot) - 0.08 * haversine_km(center[0], center[1], p.lat, p.lng), p))
        ranked.sort(key=lambda t: -t[0])
        return [p for _, p in ranked]

    # -- actions
    def feasible_candidates(self, item_id: str, *, indoor: bool | None = None, cheaper: bool = False,
                            interest: str | None = None, limit: int = 6, max_cost: int | None = None) -> list[Place]:
        loc = self.locate(item_id)
        if not loc:
            return []
        day, entry = loc
        victim = self.ctx.places[entry.place_id]
        others = [e for e in self.entries[day] if e.item_id != item_id]
        if max_cost is None and cheaper and self.ctx.item_cost(victim) > 0:
            max_cost = int(self.ctx.item_cost(victim) * 0.55)
        out: list[Place] = []
        for p in self.candidates(day, entry.slot, others, indoor=indoor, max_cost=max_cost, interest=interest):
            if _tentatively_ok(self.ctx, day, others, Entry(place_id=p.place_id, slot=entry.slot)):
                out.append(p)
                if len(out) >= limit:
                    break
        return out

    def replace(self, item_id: str, *, indoor: bool | None = None, cheaper: bool = False, interest: str | None = None,
                reason: str = "", explicit: bool = False, preferred: str | None = None,
                max_cost: int | None = None) -> bool:
        loc = self.locate(item_id)
        if not loc:
            return False
        day, entry = loc
        if entry.custom:
            return False
        if (entry.locked or entry.user_set) and not explicit:
            what = "locked item" if entry.locked else "stop you chose"
            self.notes.append(f"Kept {what} {self.ctx.places[entry.place_id].name} as is.")
            return False
        victim = self.ctx.places[entry.place_id]
        others = [e for e in self.entries[day] if e.item_id != item_id]
        if max_cost is None and cheaper and self.ctx.item_cost(victim) > 0:
            max_cost = int(self.ctx.item_cost(victim) * 0.55)
        ordered = self.candidates(day, entry.slot, others, indoor=indoor, max_cost=max_cost, interest=interest)
        if preferred:
            ordered.sort(key=lambda q: q.place_id != preferred)  # stable: preferred first, ranking otherwise kept
        for p in ordered:
            new = Entry(place_id=p.place_id, slot=entry.slot, why=f"{reason}. {make_why(self.ctx, p, day)}" if reason else make_why(self.ctx, p, day),
                        source_ids=[p.source.id], item_id=new_item_id())
            if _tentatively_ok(self.ctx, day, others, new):
                idx = next(i for i, e in enumerate(self.entries[day]) if e.item_id == item_id)
                self.entries[day][idx] = new
                self.mark(item_id, reason or "Replaced")
                return True
        return False

    def swap_across_days(self, item_id: str, reason: str) -> bool:
        """Move an outdoor stop to a dry day and bring an indoor stop from that day forward in exchange."""
        ctx = self.ctx
        loc = self.locate(item_id)
        if not loc:
            return False
        day, entry = loc
        p = ctx.places[entry.place_id]
        if is_meal_place(p):
            return False
        for d2 in sorted(self.entries, key=lambda d: abs(d - day)):
            if d2 == day or ctx.is_rainy(d2):
                continue
            for e2 in list(self.entries[d2]):
                p2 = ctx.places[e2.place_id]
                if e2.locked or e2.user_set or e2.custom or not p2.indoor or is_meal_place(p2):
                    continue
                if not (slot_ok(p, e2.slot) and slot_ok(p2, entry.slot)):
                    continue
                keep_a = [x for x in self.entries[day] if x.item_id != item_id]
                keep_b = [x for x in self.entries[d2] if x.item_id != e2.item_id]
                new_a = [*keep_a, Entry(place_id=p2.place_id, slot=entry.slot, why=f"{reason}. Brought forward from day {d2 + 1}",
                                        source_ids=list(e2.source_ids), item_id=e2.item_id)]
                new_b = [*keep_b, Entry(place_id=p.place_id, slot=e2.slot, why=(f"Moved to a drier day. {entry.why}" if ctx.is_rainy(day) else f"Moved from day {day + 1}. {entry.why}").strip(),
                                        source_ids=list(entry.source_ids), item_id=item_id)]
                ok_a = not (_day_error_keys(ctx, schedule_day(ctx, day, new_a)) - _day_error_keys(ctx, schedule_day(ctx, day, self.entries[day])))
                ok_b = not (_day_error_keys(ctx, schedule_day(ctx, d2, new_b)) - _day_error_keys(ctx, schedule_day(ctx, d2, self.entries[d2])))
                if ok_a and ok_b:
                    self.entries[day], self.entries[d2] = new_a, new_b
                    self.mark(item_id, reason)
                    self.notes.append(f"Moved {p.name} to day {d2 + 1}{' (drier)' if ctx.is_rainy(day) else ''} and brought {p2.name} forward to day {day + 1}.")
                    return True
        return False

    def remove(self, item_id: str, reason: str = "") -> bool:
        loc = self.locate(item_id)
        if not loc:
            return False
        day, _ = loc
        self.entries[day] = [e for e in self.entries[day] if e.item_id != item_id]
        self.mark(item_id, reason or "Removed")
        return True

    def _slot_for(self, day: int, interest: str | None) -> str:
        have = [e.slot for e in self.entries[day]]
        if interest == "nightlife" and "evening" not in have:
            return "evening"
        if interest == "food":
            for s in ("dinner", "lunch"):
                if s not in have:
                    return s
        if "morning" not in have:
            return "morning"
        return "afternoon"

    def add(self, day: int | None = None, interest: str | None = None, reason: str = "") -> bool:
        ctx = self.ctx
        cap = PACE_CAP[ctx.request.pace]
        order = [day] if day is not None else sorted(
            self.entries, key=lambda d: (self.stops(d) >= cap, self.stops(d), ctx.is_rainy(d)))
        room = ctx.budget - self.total_cost()
        for d in order:
            if self.stops(d) >= cap:
                continue
            slot = self._slot_for(d, interest)
            for p in self.candidates(d, slot, self.entries[d], interest=interest,
                                     indoor=True if ctx.is_rainy(d) else None):
                if ctx.item_cost(p) > room:
                    continue
                new = Entry(place_id=p.place_id, slot=slot, why=f"{reason}. {make_why(ctx, p, d)}" if reason else make_why(ctx, p, d),
                            source_ids=[p.source.id], item_id=new_item_id())
                if _tentatively_ok(ctx, d, self.entries[d], new):
                    self.entries[d].append(new)
                    return True
        # every day is full: swap the weakest activity for the requested one
        if interest:
            weakest = self._weakest(order)
            if weakest:
                return self.replace(weakest, interest=interest, reason=reason, explicit=False)
        return False

    def _weakest(self, days: list[int]) -> str | None:
        best: tuple[float, str] | None = None
        for d in days:
            for e in self.entries[d]:
                p = self.ctx.places[e.place_id]
                if e.locked or e.user_set or e.custom or is_meal_place(p) or not e.item_id:
                    continue
                s = self.ctx.score(p, day=d, slot=e.slot)
                if best is None or s < best[0]:
                    best = (s, e.item_id)
        return best[1] if best else None

    def reduce_budget(self, target: int, reason: str) -> None:
        """Close the gap with the smallest loss of value: each step picks the swap or removal that saves the most
        (up to what is still needed) per unit of value given up."""
        ctx = self.ctx
        for _ in range(30):
            need = self.total_cost() - target
            if need <= 0:
                return
            legs = {it.id: (it.travel_from_prev.cost_inr if it.travel_from_prev else 0)
                    for d in self.scheduled() for it in d.items}
            options: list[tuple[float, str, str, str | None]] = []  # (efficiency, action, item_id, alt_place_id)
            for d, es in self.entries.items():
                meals = sum(1 for x in es if is_meal_place(ctx.places[x.place_id]))
                for e in es:
                    if e.locked or e.user_set or e.custom or not e.item_id:
                        continue
                    p = ctx.places[e.place_id]
                    cost = ctx.item_cost(p)
                    value = max(ctx.score(p, day=d, slot=e.slot) + 3.5, 0.5)
                    if cost > 0:
                        alts = self.feasible_candidates(e.item_id, limit=3, max_cost=cost - 1)
                        if alts:
                            alt = alts[0]
                            saving = cost - ctx.item_cost(alt)
                            loss = max(value - max(ctx.score(alt, day=d, slot=e.slot) + 3.5, 0.5), 0.0)
                            options.append((min(saving, need) / (loss + 0.5), "replace", e.item_id, alt.place_id))
                    can_drop = len(es) > 2 and (not is_meal_place(p) or meals > 1)
                    saving = cost + legs.get(e.item_id, 0)
                    if can_drop and saving > 0:
                        options.append((min(saving, need) / (value + 0.5) * 0.8, "remove", e.item_id, None))
            if not options:
                self.notes.append(f"Could not reach ₹{target:,}; this is the closest feasible plan.")
                return
            _, action, item_id, alt_id = max(options, key=lambda o: o[0])
            if action == "replace":
                loc = self.locate(item_id)
                victim_cost = ctx.item_cost(ctx.places[loc[1].place_id]) if loc else 0
                if not self.replace(item_id, reason=reason, preferred=alt_id, max_cost=victim_cost - 1):
                    self.remove(item_id, reason)
            else:
                self.remove(item_id, reason)

    def set_pace(self, pace: str) -> None:
        ctx = self.ctx
        ctx.request.pace = pace  # type: ignore[assignment]
        cap = PACE_CAP[pace]
        for d in sorted(self.entries):
            while self.stops(d) > cap:
                victim = self._weakest([d])
                if not victim:
                    break
                self.remove(victim, f"Pace changed to {pace}")
        if pace != "relaxed":
            for d in sorted(self.entries):
                while self.stops(d) < cap:
                    if not self.add(day=d, reason=f"Pace changed to {pace}"):
                        break

    # -- itinerary CRUD
    def _slots_for(self, p: Place, preferred: str | None = None, day: int | None = None) -> list[str]:
        if is_meal_place(p):
            have = {e.slot for e in self.entries.get(day, [])} if day is not None else set()
            order = ["lunch", "dinner"] if "lunch" not in have else ["dinner", "lunch"]
        elif is_nightlife(p):
            order = ["evening"]
        else:
            order = ["morning", "afternoon", "evening"]
        if preferred and slot_ok(p, preferred):
            order = [preferred] + [s for s in order if s != preferred]
        return order

    def add_place(self, place_id: str, day: int | None = None, slot: str | None = None, start: int | None = None,
                  reason: str = "") -> bool:
        """Put a named place into the plan. The traveller asked for it, so it goes in even when it does not fit
        cleanly; its problems then show as warnings and other stops make room."""
        ctx = self.ctx
        p = ctx.places[place_id]
        if place_id in self.used():
            return False
        cap = PACE_CAP[ctx.request.pace]
        days = [day] if day is not None else sorted(
            self.entries, key=lambda d: (self.stops(d) >= cap, ctx.is_rainy(d) and not p.indoor, self.stops(d)))
        tries: list[tuple[int, Entry]] = []
        for d in days:
            for s in ([slot_near(p, start)] if start is not None else self._slots_for(p, slot, d)):
                why = make_why(ctx, p, d)
                tries.append((d, Entry(place_id=place_id, slot=s, why=f"{reason}. {why}" if reason else why,
                                       source_ids=[p.source.id], item_id=new_item_id(), fixed_start=start, user_set=True)))
        if not tries:
            return False
        clean = [(d, e) for d, e in tries if not item_errors(ctx, d, [*self.entries[d], e], e.item_id)]
        roomy = [(d, e) for d, e in clean if self.stops(d) < cap]
        d, new = (roomy or clean or tries)[0]
        self.entries[d].append(new)
        if not clean:
            self.notes.append(f"{p.name} does not fit cleanly on day {d + 1}; I added it anyway and flagged what to check.")
        return True

    def add_custom(self, title: str, day: int, start: int | None, minutes: int | None, cost: int | None, kind: str,
                   near_id: str | None, reason: str = "") -> bool:
        ctx = self.ctx
        near = ctx.places.get(near_id) if near_id else None
        p = make_custom_place(ctx, title, kind, cost_inr=cost, duration_min=minutes, near=near)
        ctx.register_place(p)
        if start is None:
            start = CUSTOM_DEFAULT_START.get(kind, 12 * 60)
            self.notes.append(f"I put “{p.name}” at {start // 60:02d}:{start % 60:02d}; tell me if the time is different.")
        self.entries[day].append(Entry(place_id=p.place_id, slot=slot_for_time(start, meal=kind == "meal"),
                                       why=reason or "Added by you", source_ids=[p.source.id], item_id=new_item_id(),
                                       fixed_start=start, duration_min=minutes, user_set=True))
        if kind == "meal":
            # your own meal replaces the planned one it collides with
            slot = slot_for_time(start, meal=True)
            for e in list(self.entries[day]):
                if e.place_id != p.place_id and e.slot == slot and not e.custom and not e.locked \
                        and is_meal_place(ctx.places[e.place_id]):
                    self.remove(e.item_id or "", f"Your own {slot} plans replace it")
        return True

    def move(self, item_id: str, to_day: int | None = None, slot: str | None = None, start: int | None = None,
             reason: str = "") -> bool:
        ctx = self.ctx
        loc = self.locate(item_id)
        if not loc:
            return False
        day, e = loc
        p = ctx.places[e.place_id]
        target = day if to_day is None else to_day
        if target not in self.entries:
            return False
        others = [x for x in self.entries[target] if x.item_id != item_id]
        old_slot = e.slot
        if start is not None:
            e.fixed_start, e.slot = start, slot_near(p, start)
        elif slot:
            if not slot_ok(p, slot):
                allowed = [s for s in SLOTS if slot_ok(p, s)]
                self.notes.append(f"{p.name} only fits the {' or '.join(allowed)} slot, so it stays there.")
            else:
                e.slot = slot
            e.fixed_start = SLOT_EARLIEST[e.slot] if e.custom else None
        elif target != day and not e.custom:
            # a new day without a time: the first slot where it has no problem of its own
            e.fixed_start = None
            for s in self._slots_for(p, e.slot, target):
                trial = Entry(**{**e.__dict__, "slot": s})
                if not item_errors(ctx, target, [*others, trial], item_id):
                    e.slot = s
                    break
        e.user_set = True
        if target != day:
            self.entries[day] = [x for x in self.entries[day] if x.item_id != item_id]
            if is_meal_place(p) and not e.custom:
                # one lunch and one dinner per day: the meal it displaces goes back the other way
                clash = next((x for x in self.entries[target] if x.slot == e.slot and not x.custom and not x.locked
                              and not x.user_set and is_meal_place(ctx.places[x.place_id])), None)
                if clash:
                    self.entries[target] = [x for x in self.entries[target] if x is not clash]
                    clash.slot = old_slot if slot_ok(ctx.places[clash.place_id], old_slot) else clash.slot
                    self.entries[day].append(clash)
                    self.mark(clash.item_id, f"Swapped with {p.name}")
                    self.notes.append(f"Moved {ctx.places[clash.place_id].name} to day {day + 1} in exchange.")
            self.entries[target].append(e)
            cap = PACE_CAP[ctx.request.pace]
            if not e.custom and self.stops(target) > cap:
                victim = self._weakest([target])
                if victim and self.stops(day) < cap:
                    loc2 = self.locate(victim)
                    if loc2:
                        v = loc2[1]
                        self.entries[target] = [x for x in self.entries[target] if x.item_id != victim]
                        self.entries[day].append(v)
                        self.mark(victim, f"Made room for {p.name}")
                        self.notes.append(f"Moved {ctx.places[v.place_id].name} to day {day + 1} to make room.")
        self.mark(item_id, reason or "Moved")
        return True

    def reslot(self, item_id: str, reason: str) -> bool:
        """Try the other slots of the same day for a stop that collides with a fixed-time entry."""
        loc = self.locate(item_id)
        if not loc:
            return False
        day, e = loc
        p = self.ctx.places[e.place_id]
        others = [x for x in self.entries[day] if x.item_id != item_id]
        for s in self._slots_for(p, None, day):
            if s == e.slot:
                continue
            trial = Entry(**{**e.__dict__, "slot": s})
            if not item_errors(self.ctx, day, [*others, trial], item_id):
                e.slot = s
                self.mark(item_id, reason)
                return True
        return False

    def set_duration(self, item_id: str, minutes: int, reason: str = "") -> bool:
        loc = self.locate(item_id)
        if not loc:
            return False
        e = loc[1]
        e.duration_min = max(15, min(int(minutes), 12 * 60))
        e.user_set = True
        self.mark(item_id, reason or "Duration changed")
        return True

    def edit(self, item_id: str, note: str | None = None, cost: int | None = None, reason: str = "") -> bool:
        loc = self.locate(item_id)
        if not loc:
            return False
        e = loc[1]
        if note is not None:
            e.note = note.strip()[:200]
        if cost is not None and e.custom:
            p = self.ctx.places[e.place_id]
            self.ctx.places[e.place_id] = p.model_copy(update={"cost_inr": max(int(cost), 0)})
        elif cost is not None:
            self.notes.append("Costs of listed places come from the provider; I can only set costs on your own entries.")
        self.mark(item_id, reason or "Edited")
        return True

    def set_lock(self, item_id: str, locked: bool) -> bool:
        loc = self.locate(item_id)
        if not loc:
            return False
        loc[1].locked = locked
        return True

    def _day_meta(self, day: int) -> dict:
        d = next((x for x in self.base.days if x.index == day), None)
        base = {"theme": d.theme, "tip": d.tip, "tip_source_ids": list(d.tip_source_ids)} if d else {}
        return {**base, **self.meta.get(day, {})}

    def swap_days(self, a: int, b: int, reason: str = "") -> bool:
        if a not in self.entries or b not in self.entries or a == b:
            return False
        stay = lambda e: e.locked or e.custom  # noqa: E731 - pinned to their date
        keep_a, move_a = [e for e in self.entries[a] if stay(e)], [e for e in self.entries[a] if not stay(e)]
        keep_b, move_b = [e for e in self.entries[b] if stay(e)], [e for e in self.entries[b] if not stay(e)]
        self.entries[a], self.entries[b] = keep_a + move_b, keep_b + move_a
        meta_a, meta_b = self._day_meta(a), self._day_meta(b)
        self.meta[a], self.meta[b] = meta_b, meta_a
        for e in move_a + move_b:
            self.mark(e.item_id, reason or "Day swapped")
            if e.item_id:
                self.protect.add(e.item_id)
        kept = [self.ctx.places[e.place_id].name for e in keep_a + keep_b]
        if kept:
            self.notes.append(f"Kept {', '.join(kept)} on {'its' if len(kept) == 1 else 'their'} original date (locked or your own entries).")
        return True

    def clear_day(self, day: int, reason: str = "") -> bool:
        if day not in self.entries:
            return False
        kept = [e for e in self.entries[day] if e.locked or e.custom]
        for e in self.entries[day]:
            if e not in kept:
                self.mark(e.item_id, reason or "Day cleared")
        self.entries[day] = kept
        if kept:
            self.notes.append(f"Kept {', '.join(self.ctx.places[e.place_id].name for e in kept)} on day {day + 1}.")
        self.meta.setdefault(day, {})["theme"] = "Free day" if not kept else self._day_meta(day).get("theme", "")
        return True

    def set_theme(self, day: int, text: str) -> bool:
        if day not in self.entries:
            return False
        self.meta.setdefault(day, {})["theme"] = text
        return True

    def run(self, plan: ImpactPlan) -> Itinerary:
        for a in plan.actions:
            if a.kind == "remove" and a.item_id:
                self.remove(a.item_id, a.reason)
            elif a.kind == "replace" and a.item_id:
                ok = self.replace(a.item_id, indoor=a.indoor, cheaper=a.cheaper, interest=a.interest,
                                  reason=a.reason, explicit=a.explicit, preferred=a.preferred)
                if not ok and a.indoor:
                    ok = self.swap_across_days(a.item_id, a.reason)
                if not ok and self.locate(a.item_id):
                    loc = self.locate(a.item_id)
                    name = self.ctx.places[loc[1].place_id].name if loc else "item"
                    # an explicit swap/closure that cannot be satisfied drops the stop; automatic ones keep it
                    if a.explicit and a.interest is None and not a.indoor and "closed" in a.reason:
                        self.remove(a.item_id, a.reason)
                    elif a.explicit and (a.reason.startswith("You want to avoid") or a.drop_if_stuck):
                        self.remove(a.item_id, a.reason)
                    else:
                        self.notes.append(f"No feasible alternative for {name}; it stays in the plan.")
            elif a.kind == "add":
                if not self.add(day=a.day, interest=a.interest, reason=a.reason):
                    self.notes.append(f"Could not fit anything new{f' for {a.interest}' if a.interest else ''} without breaking constraints.")
            elif a.kind == "reduce_budget" and a.target:
                self.reduce_budget(a.target, a.reason)
            elif a.kind == "pace" and a.pace:
                self.set_pace(a.pace)
            elif a.kind == "lock" and a.item_id:
                self.set_lock(a.item_id, a.locked is not False)
            elif a.kind == "add_place" and a.place_id:
                if not self.add_place(a.place_id, day=a.day, slot=a.slot, start=a.start, reason=a.reason):
                    self.notes.append(f"{self.ctx.places[a.place_id].name} is already in the plan.")
            elif a.kind == "add_custom" and a.text and a.day is not None:
                self.add_custom(a.text, a.day, a.start, a.minutes, a.cost, a.custom_kind or "other", a.near_id, a.reason)
            elif a.kind == "move" and a.item_id:
                self.move(a.item_id, to_day=a.to_day, slot=a.slot, start=a.start, reason=a.reason)
            elif a.kind == "duration" and a.item_id and a.minutes:
                self.set_duration(a.item_id, a.minutes, a.reason)
            elif a.kind == "edit" and a.item_id:
                self.edit(a.item_id, note=a.text, cost=a.cost, reason=a.reason)
            elif a.kind == "swap_days" and a.day is not None and a.to_day is not None:
                self.swap_days(a.day, a.to_day, a.reason)
            elif a.kind == "clear_day" and a.day is not None:
                self.clear_day(a.day, a.reason)
            elif a.kind == "theme" and a.day is not None and a.text:
                self.set_theme(a.day, a.text)
        self.itin = rebuild(self.ctx, self.base, self.entries, self.meta)
        total = self.itin.totals.cost_inr
        resolved: list[str] = []
        for n in plan.notes:
            if n.startswith("__budget_check__:"):
                target = int(n.split(":", 1)[1])
                if self.base.totals.cost_inr <= target:
                    resolved.append(f"The plan costs ₹{self.base.totals.cost_inr:,}, which already fits within ₹{target:,}, so nothing needs to change.")
                elif total > target:
                    resolved.append(f"Closest feasible plan costs ₹{total:,}; ₹{total - target:,} above the new budget.")
            else:
                resolved.append(n)
        plan.notes[:] = resolved
        return self.itin


# ----------------------------------------------------------------------------- repair


def _pinned(itin: Itinerary) -> set[str]:
    return {it.id for _, it in itin.all_items() if it.user_set or it.custom}


def repair(ctx: PlanContext, itin: Itinerary, max_loops: int = 3,
           protect: set[str] | None = None) -> tuple[Itinerary, list[Violation], int]:
    """Fix hard violations deterministically. Returns (itinerary, remaining violations, loops used).

    Stops the traveller placed or timed explicitly (and any in `protect`, placed by the current request) are left
    alone; their violations come back as warnings."""
    protect = set(protect or ())
    loops = 0
    for loop in range(1, max_loops + 1):
        pinned = _pinned(itin) | protect
        errs = [v for v in errors(validate(itin, ctx)) if v.item_id not in pinned]
        if not errs:
            break
        loops = loop
        ed = Editor(ctx, itin)
        for v in errs:
            if v.code == "over_budget":
                continue
            if v.code == "too_many_items" and v.day is not None:
                cap = PACE_CAP[ctx.request.pace]
                while v.day in ed.entries and ed.stops(v.day) > cap:
                    victim = ed._weakest([v.day])
                    if not victim:
                        break
                    ed.remove(victim, "Too many stops for the pace")
                continue
            if not v.item_id:
                continue
            if v.code == "outdoor_in_rain":
                if not (ed.replace(v.item_id, indoor=True, reason=v.message, explicit=True)
                        or ed.swap_across_days(v.item_id, v.message)):
                    continue  # keep; downgraded to a warning below
            elif v.code == "overlaps_fixed":
                if not ed.reslot(v.item_id, v.message):
                    ed.remove(v.item_id, v.message)
            elif not ed.replace(v.item_id, reason=v.message, explicit=True):
                ed.remove(v.item_id, v.message)
        if any(v.code == "over_budget" for v in errs):
            ed.reduce_budget(ctx.budget, f"Budget is ₹{ctx.budget:,}")
        itin = rebuild(ctx, itin, ed.entries)
    violations = validate(itin, ctx)
    pinned = _pinned(itin) | protect
    final: list[Violation] = []
    for v in violations:
        if v.severity == "error" and v.item_id in pinned:
            final.append(v.model_copy(update={"severity": "warning", "message": f"You asked for this: {v.message}"}))
        elif v.severity == "error" and v.code == "outdoor_in_rain":
            final.append(v.model_copy(update={"severity": "warning", "message": v.message + " No indoor alternative fits; pack rain gear."}))
        else:
            final.append(v)
    return itin, final, loops


@dataclass
class EditResult:
    itinerary: Itinerary
    violations: list[Violation]
    affected: list[AffectedItem]
    notes: list[str]
    request_patch: dict
    repair_loops: int
    diff: Diff


def execute_plan(ctx: PlanContext, base: Itinerary, plan: ImpactPlan) -> EditResult:
    """Run an impact plan on `base`, repair what it broke and compare the result with `base`."""
    ed = Editor(ctx, base)
    new = ed.run(plan)
    new, violations, loops = repair(ctx, new, protect=ed.protect)
    merged = {a.item_id: a for a in plan.affected}
    merged.update({k: v for k, v in ed.affected.items() if k not in merged})
    affected = list(merged.values())
    return EditResult(itinerary=new, violations=violations, affected=affected, notes=[*plan.notes, *ed.notes],
                      request_patch=dict(plan.request_patch), repair_loops=loops,
                      diff=diff_itineraries(base, new, affected))


def attach_warnings(itin: Itinerary, violations: list[Violation]) -> Itinerary:
    by_item: dict[str, list[str]] = {}
    for v in violations:
        if v.item_id and v.severity == "warning":
            by_item.setdefault(v.item_id, []).append(v.message)
    for d in itin.days:
        for it in d.items:
            it.warnings = by_item.get(it.id, [])
    itin.warnings = sorted({v.message for v in violations if v.item_id is None and v.severity == "warning"})
    return itin
