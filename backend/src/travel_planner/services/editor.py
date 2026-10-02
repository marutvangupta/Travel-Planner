"""Impact analysis and partial re-planning.

analyze_impact(): turn a ChangeRequest into concrete actions and the list of affected items (rules, no LLM).
Editor.run(): apply the actions to only the affected slots; everything else keeps its place (locked in effect).
repair(): bounded deterministic fix-up so the final itinerary has no hard violations.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..schemas import (
    AffectedItem,
    Change,
    ChangeRequest,
    DayWeather,
    Itinerary,
    Place,
    Source,
    Violation,
)
from ..tools.common import haversine_km, now_iso
from .context import PACE_CAP, Entry, PlanContext, is_meal_place, slot_ok
from .embeddings import tokenize
from .planner import _day_error_keys, _tentatively_ok, make_why
from .scheduler import compute_totals, entries_from_day, new_item_id, rebuild, schedule_day
from .validator import errors, validate

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
                                       interest=ch.interest, explicit=True, reason=why))
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
                if term in {it.category.lower(), *[t.lower() for t in it.tags]}:
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
        elif k == "lock":
            hit = resolve_item(itin, ch)
            if hit:
                plan.actions.append(Action("lock", item_id=hit[1].id))
    if ctx.closed:
        plan.request_patch["_closed"] = sorted(ctx.closed)
    return plan


# ----------------------------------------------------------------------------- executor


class Editor:
    def __init__(self, ctx: PlanContext, itin: Itinerary) -> None:
        self.ctx = ctx
        self.base = itin
        self.itin = itin
        self.entries = day_entries_map(itin)
        self.affected: dict[str, AffectedItem] = {}
        self.notes: list[str] = []
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
        if entry.locked and not explicit:
            self.notes.append(f"Kept locked item {self.ctx.places[entry.place_id].name} as is.")
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
                if e2.locked or not p2.indoor or is_meal_place(p2):
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
            self.entries, key=lambda d: (len(self.entries[d]) >= cap, len(self.entries[d]), ctx.is_rainy(d)))
        room = ctx.budget - self.total_cost()
        for d in order:
            if len(self.entries[d]) >= cap:
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
                if e.locked or is_meal_place(p) or not e.item_id:
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
                    if e.locked or not e.item_id:
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
            while len(self.entries[d]) > cap:
                victim = self._weakest([d])
                if not victim:
                    break
                self.remove(victim, f"Pace changed to {pace}")
        if pace != "relaxed":
            for d in sorted(self.entries):
                while len(self.entries[d]) < cap:
                    if not self.add(day=d, reason=f"Pace changed to {pace}"):
                        break

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
                    elif a.explicit and a.reason.startswith("You want to avoid"):
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
                loc = self.locate(a.item_id)
                if loc:
                    loc[1].locked = True
        self.itin = rebuild(self.ctx, self.base, self.entries)
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


def repair(ctx: PlanContext, itin: Itinerary, max_loops: int = 3) -> tuple[Itinerary, list[Violation], int]:
    """Fix hard violations deterministically. Returns (itinerary, remaining violations, loops used)."""
    loops = 0
    for loops in range(1, max_loops + 1):
        violations = validate(itin, ctx)
        errs = errors(violations)
        if not errs:
            return itin, violations, loops - 1
        ed = Editor(ctx, itin)
        for v in errs:
            if v.code == "over_budget":
                continue
            if v.code == "too_many_items" and v.day is not None:
                cap = PACE_CAP[ctx.request.pace]
                while len(ed.entries.get(v.day, [])) > cap:
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
            elif not ed.replace(v.item_id, reason=v.message, explicit=True):
                ed.remove(v.item_id, v.message)
        if any(v.code == "over_budget" for v in errs):
            ed.reduce_budget(ctx.budget, f"Budget is ₹{ctx.budget:,}")
        itin = rebuild(ctx, itin, ed.entries)
    violations = validate(itin, ctx)
    final: list[Violation] = []
    for v in violations:
        if v.severity == "error" and v.code == "outdoor_in_rain":
            final.append(v.model_copy(update={"severity": "warning", "message": v.message + " No indoor alternative fits; pack rain gear."}))
        else:
            final.append(v)
    return itin, final, loops


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
