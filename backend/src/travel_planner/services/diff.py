"""Compare two itinerary versions and measure how stable a re-plan was."""

from __future__ import annotations

from ..schemas import AffectedItem, Diff, Item, ItemChange, Itinerary


def _by_place(itin: Itinerary) -> dict[str, tuple[int, str, int, str]]:
    return {it.place_id: (d.index, it.slot, it.start, it.name) for d, it in itin.all_items()}


def _items(itin: Itinerary) -> dict[str, Item]:
    return {it.place_id: it for _, it in itin.all_items()}


def _edits(a: Item, b: Item) -> list[str]:
    out = []
    if (a.end - a.start) != (b.end - b.start):
        m = b.end - b.start
        out.append(f"now {m // 60}h{m % 60:02d}")
    if a.note != b.note:
        out.append(f"note: “{b.note}”" if b.note else "note removed")
    if a.locked != b.locked:
        out.append("locked" if b.locked else "unlocked")
    if a.est_cost_inr != b.est_cost_inr and a.custom:
        out.append(f"cost ₹{b.est_cost_inr:,}")
    return out


def _cap(text: str) -> str:
    return text[:1].upper() + text[1:]


def interest_counts(itin: Itinerary) -> dict[str, int]:
    counts: dict[str, int] = {}
    for _, it in itin.all_items():
        if it.custom:
            continue
        for t in it.tags:
            counts[t] = counts.get(t, 0) + 1
    return counts


def _fmt(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def diff_itineraries(before: Itinerary, after: Itinerary, affected: list[AffectedItem] | None = None) -> Diff:
    a, b = _by_place(before), _by_place(after)
    items_a, items_b = _items(before), _items(after)
    changes: list[ItemChange] = []
    for pid, (day, _slot, _start, name) in a.items():
        if pid not in b:
            changes.append(ItemChange(kind="removed", name=name, place_id=pid, day_from=day,
                                      detail=f"Removed from day {day + 1}"))
    for pid, (day, _slot, _start, name) in b.items():
        if pid not in a:
            changes.append(ItemChange(kind="added", name=name, place_id=pid, day_to=day,
                                      detail=f"Added to day {day + 1}"))
        else:
            d0, _, s0, _ = a[pid]
            if d0 != day:
                changes.append(ItemChange(kind="moved", name=name, place_id=pid, day_from=d0, day_to=day,
                                          detail=f"Day {d0 + 1} to day {day + 1}"))
            elif abs(s0 - b[pid][2]) >= 15:
                changes.append(ItemChange(kind="retimed", name=name, place_id=pid, day_from=d0, day_to=day,
                                          detail=f"{_fmt(s0)} to {_fmt(b[pid][2])}"))
            else:
                edits = _edits(items_a[pid], items_b[pid])
                if edits:
                    changes.append(ItemChange(kind="edited", name=name, place_id=pid, day_from=d0, day_to=day,
                                              detail=_cap("; ".join(edits))))
    for d0, d1 in zip(before.days, after.days, strict=False):
        if d0.theme != d1.theme:
            changes.append(ItemChange(kind="edited", name=f"Day {d1.index + 1}", place_id="", day_from=d1.index,
                                      day_to=d1.index, detail=f"Theme: {d1.theme or 'none'}"))

    affected_ids = {x.item_id for x in affected or []}
    affected_places = {it.place_id for _, it in before.all_items() if it.id in affected_ids}
    unaffected = [pid for pid in a if pid not in affected_places]
    kept = [pid for pid in unaffected if pid in b and b[pid][0] == a[pid][0]]
    stability = len(kept) / len(unaffected) if unaffected else 1.0

    n_add = sum(1 for c in changes if c.kind == "added")
    n_rm = sum(1 for c in changes if c.kind == "removed")
    n_mv = sum(1 for c in changes if c.kind in ("moved", "retimed"))
    n_ed = sum(1 for c in changes if c.kind == "edited")
    cd = after.totals.cost_inr - before.totals.cost_inr
    parts = []
    if n_rm or n_add:
        parts.append(f"{n_rm} removed, {n_add} added")
    if n_mv:
        parts.append(f"{n_mv} moved or retimed")
    if n_ed:
        parts.append(f"{n_ed} edited")
    parts.append(f"cost {'+' if cd > 0 else '−' if cd < 0 else '±'}₹{abs(cd):,}")
    return Diff(
        changes=changes, cost_before=before.totals.cost_inr, cost_after=after.totals.cost_inr, cost_delta=cd,
        travel_before=before.totals.travel_minutes, travel_after=after.totals.travel_minutes,
        travel_delta=after.totals.travel_minutes - before.totals.travel_minutes,
        items_before=before.totals.items, items_after=after.totals.items, stability=round(stability, 3),
        interests_before=interest_counts(before), interests_after=interest_counts(after), summary="; ".join(parts),
    )
