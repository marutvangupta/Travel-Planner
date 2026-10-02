"""Natural-language -> structured ChangeRequest.

The rule-based parser below is the offline path and also the safety net for the LLM router. It is deliberately
conservative: when it cannot understand a message it says so instead of guessing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..schemas import Change, ChangeRequest, Itinerary

VOCAB: dict[str, str] = {
    "museum": "museum", "museums": "museum", "gallery": "gallery", "galleries": "gallery", "temple": "temple",
    "temples": "temple", "fort": "fort", "forts": "fort", "palace": "palace", "palaces": "palace",
    "shopping": "shopping", "shop": "shopping", "markets": "market", "market": "market", "bazaar": "market",
    "nightlife": "nightlife", "party": "nightlife", "parties": "nightlife", "club": "nightlife", "clubs": "nightlife",
    "bar": "bar", "bars": "bar", "beach": "beach", "beaches": "beach", "park": "park", "parks": "park",
    "food": "food", "street food": "food", "foodie": "food", "restaurant": "restaurant", "history": "history",
    "historic": "history", "historical": "history", "culture": "culture", "cultural": "culture", "art": "art",
    "nature": "nature", "adventure": "adventure", "hiking": "adventure", "relaxing": "relaxation",
    "relaxation": "relaxation", "spa": "relaxation", "architecture": "architecture", "walks": "nature",
}
CATEGORY_WORDS = {"museum", "gallery", "temple", "fort", "palace", "market", "bar", "beach", "park", "restaurant"}

DAY_WORDS = {"first": 0, "second": 1, "third": 2, "fourth": 3, "fifth": 4, "last": -1}


@dataclass
class RouterResult:
    intent: str  # edit | constraint_change | whatif | question | chitchat
    request: ChangeRequest = field(default_factory=lambda: ChangeRequest(changes=[]))
    question: str | None = None
    message: str | None = None  # a clarification or fallback response


def parse_amount(text: str) -> int | None:
    m = re.search(
        r"(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakh|lac|lakhs)?\b", text, flags=re.I)
    if not m:
        return None
    val = float(m.group(1).replace(",", ""))
    unit = (m.group(2) or "").lower()
    if unit in ("k", "thousand"):
        val *= 1_000
    elif unit in ("lakh", "lac", "lakhs"):
        val *= 100_000
    return int(val)


def parse_day(text: str, n_days: int) -> int | None:
    m = re.search(r"\bday\s*(\d+)\b", text)
    if m:
        d = int(m.group(1)) - 1
        return d if 0 <= d < n_days else None
    for word, idx in DAY_WORDS.items():
        if re.search(rf"\b{word}\s+day\b", text):
            d = n_days - 1 if idx == -1 else idx
            return d if 0 <= d < n_days else None
    return None


def _vocab_hit(text: str) -> str | None:
    for phrase in sorted(VOCAB, key=len, reverse=True):
        if re.search(rf"\b{re.escape(phrase)}\b", text):
            return VOCAB[phrase]
    return None


def _item_name_in(text: str, itin: Itinerary) -> str | None:
    best, best_len = None, 0
    low = text.lower()
    for _, it in itin.all_items():
        name = it.name.lower()
        key = re.sub(r"\(.*?\)", "", name).strip()
        for cand in {name, key, key.split(",")[0].strip()}:
            if cand and cand in low and len(cand) > best_len:
                best, best_len = it.name, len(cand)
    if best:
        return best
    # fall back to meaningful word overlap (e.g. "the fort on day 2", "amber")
    words = [w for w in re.findall(r"[a-z]{4,}", low) if w not in {"day", "that", "this", "with", "from", "have", "something", "instead", "swap", "replace", "remove", "drop"}]
    scored: list[tuple[int, str]] = []
    for _, it in itin.all_items():
        toks = set(re.findall(r"[a-z]{4,}", it.name.lower()))
        hit = len(toks & set(words))
        if hit:
            scored.append((hit, it.name))
    scored.sort(reverse=True)
    return scored[0][1] if scored else None


def _category_item(text: str, itin: Itinerary, day: int | None) -> str | None:
    """'the museum on day 2' -> a concrete item name."""
    word = _vocab_hit(text)
    if not word:
        return None
    for d, it in itin.all_items():
        if day is not None and d.index != day:
            continue
        if it.category == word or word in it.tags:
            return it.name
    return None


def parse_message(message: str, itin: Itinerary, budget_inr: int, pace: str) -> RouterResult:
    text = message.strip()
    low = text.lower()
    n_days = len(itin.days)

    m = re.match(r"^(what if|what would happen if|what happens if|suppose|how would (it|things) change if|"
                 r"what about if|and if|how about if)\b[\s,:-]*(.*)$", low)
    if m:
        inner = parse_message(m.group(3) or low, itin, budget_inr, pace)
        if inner.request.changes:
            return RouterResult("whatif", inner.request)
        return RouterResult("chitchat", message="I could not turn that scenario into a change I can test. "
                            "Try something like “what if I reduce the budget by ₹10,000?” or “what if it rains on day 2?”.")

    day = parse_day(low, n_days)
    changes: list[Change] = []

    # ------------------------------------------------------------------ budget
    amount = parse_amount(low) if re.search(r"budget|spend|cost|cheaper|afford|expens|₹|rs\b|inr|\bk\b|lakh", low) else None
    if re.search(r"\b(reduce|cut|lower|decrease|drop|trim|save|less|minus|shave)\b", low) and re.search(r"budget|spend|cost|₹|rs\b|inr", low) and amount:
        changes.append(Change(kind="budget_delta", amount_inr=-amount))
    elif re.search(r"\b(increase|raise|add|extra|more|bump)\b", low) and re.search(r"budget|spend|₹|rs\b|inr", low) and amount:
        changes.append(Change(kind="budget_delta", amount_inr=amount))
    elif re.search(r"budget (is|to|of|=|:)|set (the )?budget|new budget|total budget", low) and amount:
        changes.append(Change(kind="budget_set", amount_inr=amount))
    elif re.search(r"too expensive|too costly|cheaper|cheap(er)? option|save money|over budget", low) and not _vocab_hit(low):
        changes.append(Change(kind="budget_delta", amount_inr=-int(budget_inr * 0.15), note="Trim about 15%"))
    if changes:
        return RouterResult("constraint_change" if "?" not in low else "whatif", ChangeRequest(changes=changes))

    # ------------------------------------------------------------------ weather / closures
    if re.search(r"\b(rain|raining|rainy|storm|monsoon|wet)\b", low) and not re.search(r"\b(ask|question)\b", low):
        return RouterResult("edit", ChangeRequest(changes=[Change(kind="weather", day=day)]))
    if re.search(r"\b(closed|shut|sold out|unavailable|fully booked|cancelled|canceled)\b", low):
        name = _item_name_in(text, itin) or _category_item(low, itin, day)
        if name:
            return RouterResult("edit", ChangeRequest(changes=[Change(kind="closure", place_name=name, day=day)]))
        return RouterResult("chitchat", message="Which stop is closed? Mention its name, for example “Amber Fort is closed”.")

    # ------------------------------------------------------------------ pace / start time
    if re.search(r"more relax|slower|less packed|fewer (things|activities|stops)|take it easy|too (packed|busy|much)|lighter", low) and "?" not in low:
        target = "relaxed"
        return RouterResult("edit", ChangeRequest(changes=[Change(kind="pace", pace=target)]))
    if re.search(r"more packed|busier|more activities|more stops|faster pace|squeeze in more|see more", low) and "?" not in low:
        target = "packed" if pace == "balanced" else "balanced"
        return RouterResult("edit", ChangeRequest(changes=[Change(kind="pace", pace=target)]))
    if re.search(r"no early|not (an )?early|start later|late start|sleep in|later start|no morning", low):
        return RouterResult("edit", ChangeRequest(changes=[Change(kind="day_start", minutes=10 * 60 + 30)]))

    # ------------------------------------------------------------------ questions
    if "?" in low or re.match(r"^(is|are|how|when|where|which|why|what|can|could|does|do|will|should|tell me|show me)\b", low):
        return RouterResult("question", question=text)

    # ------------------------------------------------------------------ swaps and removals
    verb_swap = re.search(r"\b(swap|replace|change|switch|exchange)\b", low)
    verb_remove = re.search(r"\b(remove|drop|delete|cancel|skip|get rid of|take out|cut)\b", low)
    verb_avoid = re.search(r"\b(avoid|no more|don'?t (want|like|need)|do not (want|like)|without|hate|dislike|not into)\b", low)
    verb_add = re.search(r"\b(add|include|want|need|more|prefer|love|squeeze in|fit in)\b", low)
    verb_lock = re.search(r"\b(keep|lock|don'?t change|do not change|leave)\b", low)

    interest = _vocab_hit(low)
    indoor = True if re.search(r"\bindoors?\b", low) else (False if re.search(r"\boutdoors?\b|\bopen[- ]air\b", low) else None)
    cheaper = bool(re.search(r"\bcheaper|less expensive|budget[- ]friendly|affordable\b", low))

    if verb_swap or re.search(r"\binstead\b", low):
        # name of the thing being replaced: text before "with/for/to/by/instead"
        head = re.split(r"\b(with|for|to|by|into|instead)\b", low, maxsplit=1)[0]
        name = _item_name_in(head, itin) or _item_name_in(text, itin) or _category_item(head, itin, day)
        target_interest = None
        tail = low[len(head):]
        if tail:
            target_interest = _vocab_hit(tail)
        if name:
            return RouterResult("edit", ChangeRequest(changes=[Change(
                kind="replace_item", place_name=name, day=day, interest=target_interest, indoor=indoor, cheaper=cheaper)]))
        return RouterResult("chitchat", message="Which stop should I swap? Mention it by name, for example “swap the museum on day 2 for something outdoors”.")

    if verb_avoid and interest:
        return RouterResult("edit", ChangeRequest(changes=[Change(kind="avoid", interest=interest)]))

    if verb_remove:
        name = _item_name_in(text, itin)
        if name:
            return RouterResult("edit", ChangeRequest(changes=[Change(kind="remove_item", place_name=name, day=day)]))
        if interest and (interest in CATEGORY_WORDS or interest in ("shopping", "nightlife")):
            if day is None:
                return RouterResult("edit", ChangeRequest(changes=[Change(kind="avoid", interest=interest)]))
            item = _category_item(low, itin, day)
            if item:
                return RouterResult("edit", ChangeRequest(changes=[Change(kind="remove_item", place_name=item, day=day)]))
        return RouterResult("chitchat", message="Which stop should I remove? Mention its name or say something like “drop the museum on day 2”.")

    if verb_lock:
        name = _item_name_in(text, itin)
        if name:
            return RouterResult("edit", ChangeRequest(changes=[Change(kind="lock", place_name=name)]))

    if verb_add and interest:
        if re.search(r"\bmore\b|\bprefer\b|\blove\b", low) and not re.search(r"\badd\b|\binclude\b", low):
            return RouterResult("edit", ChangeRequest(changes=[Change(kind="prefer", interest=interest)]))
        return RouterResult("edit", ChangeRequest(changes=[Change(kind="add_item", interest=interest, day=day,
                                                                   note=f"You asked for {interest}")]))

    return RouterResult(
        "chitchat",
        message="I can swap or remove stops, add things you like, change the pace, cut the budget, or re-plan for rain. "
                "Try “swap the fort on day 2 for something indoors” or “what if I reduce my budget by ₹10,000?”.",
    )


# ----------------------------------------------------------------------------- question answering (offline)


def fmt_time(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def answer_question(question: str, itin: Itinerary, guides: list) -> tuple[str, list[str]]:  # noqa: ANN001
    """Answer from the itinerary itself; fall back to retrieved guide passages. Returns (text, source_ids)."""
    low = question.lower()
    day = parse_day(low, len(itin.days))
    t = itin.totals

    if re.search(r"packed|too much|busy|tiring|rushed|relaxed|exhaust", low):
        targets = [itin.days[day]] if day is not None else itin.days
        lines = []
        for d in targets:
            travel = sum(i.travel_from_prev.minutes for i in d.items if i.travel_from_prev)
            span = (d.items[-1].end - d.items[0].start) if d.items else 0
            verdict = "full" if len(d.items) >= 5 or travel > 150 else "comfortable"
            lines.append(f"Day {d.index + 1}: {len(d.items)} stops, {travel} min of travel, "
                         f"{fmt_time(d.items[0].start)}–{fmt_time(d.items[-1].end)} ({span // 60}h{span % 60:02d}). That feels {verdict}.")
        return "\n".join(lines), []

    if re.search(r"how much|cost|budget|spend|price|expens|afford|left", low):
        return (f"The plan costs about ₹{t.cost_inr:,} against a ₹{t.budget_inr:,} budget, leaving ₹{t.remaining_inr:,}. "
                f"That is ₹{t.activities_inr:,} on activities, ₹{t.food_inr:,} on food and ₹{t.transport_inr:,} on local transport."), []

    if re.search(r"weather|rain|forecast|temperature|hot|umbrella", low):
        rows = []
        for d in ([itin.days[day]] if day is not None else itin.days):
            w = d.weather
            if w:
                rows.append(f"Day {d.index + 1} ({d.date}): {w.condition}, {w.precip_prob}% rain, {w.temp_min:.0f}–{w.temp_max:.0f}°C")
        srcs = sorted({d.weather.source.id for d in itin.days if d.weather and d.weather.source})
        return ("\n".join(rows) or "No weather data is attached to this plan."), srcs[:2]

    if re.search(r"open|close|closing|hours|time|when", low):
        name = _item_name_in(question, itin)
        if name:
            for d, it in itin.all_items():
                if it.name == name:
                    return (f"{it.name} is planned on day {d.index + 1} from {fmt_time(it.start)} to {fmt_time(it.end)}. "
                            f"Opening hours were checked against that slot."), [it.place_id]

    if re.search(r"far|distance|travel|how long|commute|get to", low):
        targets = [itin.days[day]] if day is not None else itin.days
        rows = [f"Day {d.index + 1}: {sum(i.travel_from_prev.minutes for i in d.items if i.travel_from_prev)} min travelling"
                for d in targets]
        return "\n".join(rows), []

    if guides:
        top = guides[0]
        return f"{top.text} (from the {top.destination.title()} guide, section “{top.section}”)", [f"guide:{top.chunk_id}"]
    return ("I could not find that in your itinerary or the travel guides. I can answer questions about timing, cost, weather and travel "
            "time, or look up local tips."), []
