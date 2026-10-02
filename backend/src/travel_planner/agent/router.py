"""Natural-language -> structured ChangeRequest.

The rule-based parser below is the offline path and also the safety net for the LLM agent. It is deliberately
conservative: when it cannot understand a message it says so instead of guessing, and when it understands the
action but not its target it asks a clarifying question with quick-reply options (and remembers the half-built
change so the next message can complete it).
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
    intent: str  # edit | constraint_change | whatif | question | chitchat | clarify
    request: ChangeRequest = field(default_factory=lambda: ChangeRequest(changes=[]))
    question: str | None = None
    message: str | None = None  # a clarification or fallback response
    options: list[str] = field(default_factory=list)  # quick replies for a clarifying question
    pending: Change | None = None  # the half-built change a clarifying question is about


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


def _item_name_in(text: str, itin: Itinerary, day: int | None = None) -> str | None:
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
    for d, it in itin.all_items():
        if day is not None and d.index != day:
            continue
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


# ----------------------------------------------------------------------------- CRUD parsing helpers

EDIT_VERB = (r"(?:add|include|remove|drop|delete|move|shift|push|pull|bring|put|swap|switch|replace|change|clear|"
             r"free up|make|set|lock|unlock|skip|cancel|book|schedule|rename|spend|cut|reduce|increase|raise|avoid|"
             r"keep|visit|squeeze|fit|start|retime|note)")
ADD_PLACE_VERB = r"\b(add|include|visit|see|go to|stop (?:by|at)|fit in|squeeze in|check out|put|bring)\b"
MOVE_VERB = r"\b(move|shift|push|pull|bring|reschedule|postpone|relocate|put|change|switch|retime|do)\b"
DAY_WORD = r"(?:first|second|third|fourth|fifth|sixth|last)"
WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
SLOT_PHRASE = re.compile(r"\b(?:in the|for|at|this|to the|into the|during|by)\s+(morning|afternoon|evening|night|lunch|"
                         r"lunchtime|dinner|dinnertime)\b|\b(tonight)\b")
SLOT_MAP = {"morning": "morning", "afternoon": "afternoon", "evening": "evening", "night": "evening", "tonight": "evening",
            "lunch": "lunch", "lunchtime": "lunch", "dinner": "dinner", "dinnertime": "dinner"}
CUSTOM_KIND_PATTERNS: list[tuple[str, str]] = [
    ("transport", r"\b(flights?|fly(?:ing)?|plane|train|bus|coach|ferry|cab|taxi|airport|transfer|pick-?up|drop-?off|"
                  r"departure|arrival)\b"),
    ("lodging", r"\b(check[- ]?in|check[- ]?out|hotel|hostel|airbnb|guest ?house|homestay)\b"),
    ("meal", r"\b(breakfast|brunch|lunch|dinner|drinks|coffee|tea)\s+(?:with|at (?:my|our|a friend|friends))\b"),
    ("other", r"\b(meeting|call|appointment|wedding|conference|interview|massage|haircut|meetup|meet (?:my|our|a|up)|"
              r"visit (?:my|our)|catch up)\b"),
]
CUSTOM_VERB = (r"\b(add|book|schedule|put|block|reserve|include|pencil in|i have|we have|i've got|we've got|there'?s|"
               r"there is|i need|we need)\b")
EXISTING_VERB = r"\b(move|shift|remove|delete|drop|cancel|change|reschedule|push|pull|rename|note|lock|unlock|spend|swap|replace)\b"
POLITE = re.compile(r"^(?:(?:hey|hi|ok|okay|so|great|cool|thanks)[,!.\s]+)?(?:please\s+|pls\s+|kindly\s+)?"
                    r"(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i(?:'d| would) like (?:you )?to\s+|"
                    r"i want (?:you )?to\s+|let'?s\s+|go ahead and\s+)?", re.I)
NEEDS_ITEM = {"remove_item", "replace_item", "closure", "move_item", "retime_item", "set_duration", "edit_item",
              "lock", "unlock"}


def strip_polite(text: str) -> tuple[str, bool]:
    """'Could you please move X to day 3?' is a command, not a question."""
    m = POLITE.match(text)
    if not m or not m.group(0).strip():
        return text, False
    return text[m.end():].rstrip(" ?") or text, True


def split_clauses(text: str) -> list[str]:
    """'remove X and add Y on day 2; then make it relaxed' -> three clauses. 'swap day 1 and day 2' stays whole."""
    parts = re.split(rf"\s*;\s*|\s*,?\s+(?:and\s+)?then\s+|\s*,?\s+and\s+also\s+|\s*,\s*also\s+|"
                     rf"\s*,?\s+and\s+(?={EDIT_VERB}\b)|\s*,\s+(?={EDIT_VERB}\b)", text, flags=re.I)
    return [p.strip(" ,.") for p in parts if p and p.strip(" ,.")]


def parse_time(text: str) -> int | None:
    """'10am', '1:30 pm', '18:00', 'noon', 'at 6' (afternoon assumed for 1-7) -> minutes since midnight."""
    low = text.lower()
    if re.search(r"\b(noon|midday)\b", low):
        return 12 * 60
    m = re.search(r"(?<![₹\d.,])\b(\d{1,2})[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?)?(?!\d)", low)
    hour = minute = None
    ampm = ""
    if m:
        hour, minute, ampm = int(m.group(1)), int(m.group(2)), (m.group(3) or "").replace(".", "")
    else:
        m = re.search(r"\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])", low)
        if m:
            hour, minute, ampm = int(m.group(1)), 0, m.group(2).replace(".", "")
        else:
            m = re.search(r"\b(?:at|by|around|from)\s+(\d{1,2})\b(?!\s*(?:k\b|%|people|of us|days?\b|hours?|hrs?\b|h\b|"
                          r"mins?\b|minutes?|lakh|thousand|[.,]\d))", low)
            if m:
                hour, minute = int(m.group(1)), 0
                if 1 <= hour <= 7:
                    hour += 12
    if hour is None or minute is None:
        return None
    if ampm == "pm" and hour < 12:
        hour += 12
    elif ampm == "am" and hour == 12:
        hour = 0
    if not (0 <= hour < 24 and 0 <= minute < 60):
        return None
    return hour * 60 + minute


def parse_duration(text: str) -> int | None:
    """'2 hours', '90 minutes', '1.5h', '2h30', 'an hour and a half' -> minutes."""
    low = text.lower()
    m = re.search(r"\b(\d+)\s*h\s*(\d{2})\b", low)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    total, found = 0, False
    m = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b", low)
    if m:
        total, found = total + round(float(m.group(1)) * 60), True
    m = re.search(r"\b(\d+)\s*(?:minutes?|mins?)\b", low)
    if m:
        total, found = total + int(m.group(1)), True
    if found:
        return total
    for phrase, minutes in (("an hour and a half", 90), ("half an hour", 30), ("couple of hours", 120),
                            ("a couple hours", 120), ("an hour", 60), ("all day", 480), ("half a day", 240),
                            ("half day", 240)):
        if phrase in low:
            return minutes
    return None


def parse_slot(text: str) -> str | None:
    m = SLOT_PHRASE.search(text.lower())
    if not m:
        return None
    return SLOT_MAP[m.group(1) or m.group(2)]


def _day_index(num: str | None, word: str | None, n_days: int) -> int | None:
    if num:
        return int(num) - 1
    if word:
        return n_days - 1 if word == "last" else DAY_WORDS.get(word)
    return None


def day_refs(text: str, n_days: int) -> list[int]:
    """Every day mentioned, in order, 0-based and not range-checked (so an out-of-range day can be reported)."""
    low = text.lower()
    found: list[tuple[int, int]] = []
    for m in re.finditer(rf"\bdays?\s*(\d+)(?:\s*(?:and|&|,|with|or)\s*(?:day\s*)?(\d+))?|\b({DAY_WORD})\s+day\b|"
                         rf"\bday\s+(one|two|three|four|five|six)\b", low):
        if m.group(1):
            found.append((m.start(1), int(m.group(1)) - 1))
            if m.group(2):
                found.append((m.start(2), int(m.group(2)) - 1))
        elif m.group(3):
            found.append((m.start(3), _day_index(None, m.group(3), n_days) or 0))
        elif m.group(4):
            found.append((m.start(4), WORD_NUM[m.group(4)] - 1))
    return [d for _, d in sorted(found)]


def _target_day(low: str, n_days: int) -> int | None:
    m = re.search(rf"\b(?:to|onto|into|till|until)\s+(?:the\s+)?(?:day\s*(\d+)|({DAY_WORD})\s+day)\b", low)
    if m is None and not re.search(r"\bfrom\b", low):
        m = re.search(rf"\b(?:on|for)\s+(?:the\s+)?(?:day\s*(\d+)|({DAY_WORD})\s+day)\b", low)
    return _day_index(m.group(1), m.group(2), n_days) if m else None


def _source_day(low: str, n_days: int) -> int | None:
    m = re.search(rf"\b(?:from|of|on)\s+(?:the\s+)?(?:day\s*(\d+)|({DAY_WORD})\s+day)\b", low)
    return _day_index(m.group(1), m.group(2), n_days) if m else None


def _cost(low: str) -> int | None:
    m = re.search(r"(?:₹|\brs\.?\s*|\binr\s*)(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakh)?\b|"
                  r"\bcost(?:s|ing)?\s+(?:about\s+|around\s+)?₹?\s*(\d[\d,]*)\s*(k)?\b", low)
    return parse_amount(m.group(0)) if m else None


def custom_kind(low: str) -> str | None:
    for kind, pat in CUSTOM_KIND_PATTERNS:
        if re.search(pat, low):
            return kind
    return None


def custom_title(text: str) -> str:
    t = re.sub(rf"^.*?{CUSTOM_VERB}\s+", "", text, count=1, flags=re.I)
    t = re.sub(r"^(?:a|an|the|my|our)\s+", "", t, flags=re.I)
    t = re.split(rf"\s+(?:at|on|by|around|from|for|costing|which costs|that costs)\s+(?=\d|day\b|the\s+{DAY_WORD}\s+day|"
                 rf"{DAY_WORD}\s+day|₹|rs\b|inr|noon|midday)|\s+(?:on\s+)?day\s*\d|\s+tonight\b|\s+tomorrow\b|\s*,|"
                 r"\s+for\s+\d+\s*(?:hours?|hrs?|h|minutes?|mins?)\b|\s+at\s+(?:noon|midday)", t, maxsplit=1, flags=re.I)[0]
    t = re.sub(r"\s+(?:is|are|leaves|departs|arrives|starts|begins|will be)$", "", t.strip(" .!?"), flags=re.I)
    return t[:1].upper() + t[1:]


def _named_target(text: str) -> str | None:
    """'add Panna Meena ka Kund to day 2' -> 'Panna Meena ka Kund'; None for 'add a museum' or 'add more food'."""
    m = re.search(ADD_PLACE_VERB, text, flags=re.I)
    if not m:
        return None
    rest = text[m.end():]
    rest = re.split(rf"\s+(?:to|on|for|in|at|into|onto|during|by)\s+(?:the\s+)?(?:day\b|{DAY_WORD}\b|morning|afternoon|"
                    r"evening|lunch|dinner|night|itinerary|plan|trip|schedule|\d)|\s+tonight\b|\s+tomorrow\b|,|\s+if\b|"
                    r"\s+please\b|\s+as well\b|\s+too\b|\s+instead\b", rest, maxsplit=1, flags=re.I)[0]
    name = re.sub(r"^(?:a|an|the|some|another|one more|more|a few|something|somewhere|anything)\s+", "", rest.strip(" .!?"),
                  flags=re.I).strip()
    name = re.sub(r"\s+(?:place|spot|stop|activity|experience|thing|option)s?$", "", name, flags=re.I)
    low = name.lower()
    generic = {"indoors", "outdoors", "indoor", "outdoor", "fun", "nice", "cool", "interesting", "new", "local", "cheap",
               "cheaper", "free", "different", "else", "here", "there", "it", "that", "this", "them", "back", "in"}
    if not low or low in generic or low in VOCAB or all(w in VOCAB or w in generic for w in low.split()):
        return None
    if re.match(r"^(?:more|something|some|a|an)\b", low):
        return None
    return name


def clarify(question: str, itin: Itinerary, pending: Change, *, day: int | None = None,
            options: list[str] | None = None) -> RouterResult:
    if options is None:
        items = [it.name for d, it in itin.all_items() if day is None or d.index == day]
        options = items[:8]
    return RouterResult("clarify", message=question, options=options, pending=pending)


def _day_options(itin: Itinerary) -> list[str]:
    return [f"Day {d.index + 1}" for d in itin.days]


def parse_crud(text: str, itin: Itinerary, *, travelers: int | None = None, commanded: bool = False) -> RouterResult | None:
    """Itinerary CRUD in plain words. Returns None when the clause is not one of these (the older rules then run)."""
    low = text.lower()
    n = len(itin.days)
    is_question = not commanded and ("?" in low or re.match(
        r"^(is|are|how|when|where|which|why|what|does|do i|do we|will|should|tell me|show me)\b", low))
    if is_question:
        return None
    refs = day_refs(low, n)
    day = refs[0] if refs else None
    edit = lambda *chs: RouterResult("edit", ChangeRequest(changes=list(chs)))  # noqa: E731

    # ---------------------------------------------------------------- notes (before removals: "remove the note on X")
    m = re.search(r"\b(?:remove|delete|clear)\s+(?:the\s+)?note\s+(?:from|on|for)\s+(.+)$", text, re.I)
    if m:
        name = _item_name_in(m.group(1), itin)
        return edit(Change(kind="edit_item", place_name=name, text="")) if name else \
            clarify("Which stop's note should I remove?", itin, Change(kind="edit_item", text=""))
    m = re.search(r"\b(?:add\s+(?:a\s+)?note|note|notes?)\s*(?:to|for|on|about)?\s+(.+?)(?:\s*:\s*|\s+[-–—]\s+)(.+)$", text, re.I)
    if m:
        name = _item_name_in(m.group(1), itin)
        note = m.group(2).strip()
        return edit(Change(kind="edit_item", place_name=name, text=note)) if name else \
            clarify("Which stop is the note for?", itin, Change(kind="edit_item", text=note))
    m = re.search(r"\bremind me to\s+(.+)", text, re.I)
    if m:
        name = _item_name_in(text, itin)
        note = "Remember to " + re.sub(r"\s+(?:for|at|when (?:we|i) visit)\s+.+$", "", m.group(1)).strip(" .")
        if name:
            return edit(Change(kind="edit_item", place_name=name, text=note))
        return clarify("Which stop is the reminder for?", itin, Change(kind="edit_item", text=note))

    # ---------------------------------------------------------------- the traveller's own entries
    kind = custom_kind(low)
    possessive = re.search(r"\b(?:my|our)\b", low) and (parse_time(low) is not None) and \
        re.search(r"\b(is|leaves|departs|arrives|lands|starts|at)\b", low)
    if kind and (re.search(CUSTOM_VERB, low) or possessive) and not re.search(EXISTING_VERB, low):
        title = custom_title(text)
        ch = Change(kind="add_custom", text=title or kind.title(), custom_kind=kind, day=day, start_min=parse_time(low),
                    duration_min=parse_duration(re.sub(r"\d{1,2}[:.]\d{2}", "", low)), amount_inr=_cost(low))
        if day is None:
            return clarify(f"Which day is “{ch.text}” on?", itin, ch, options=_day_options(itin))
        return edit(ch)

    # ---------------------------------------------------------------- trip settings (diet, access, travellers)
    m = re.search(r"\b(we(?:'re| are)|i(?:'m| am)|now|switch(?:ed)? to|go(?:ing)?|became|make (?:it|meals|the food|everything)|"
                  r"all|everyone(?:'s| is)?)\b[^.]*?\b(vegan|vegetarian|veggie|pure veg)\b", low)
    if m and not re.search(r"\b(add|include|find|swap|replace|restaurant|cafe)\b", low):
        return RouterResult("constraint_change", ChangeRequest(changes=[Change(
            kind="set_constraints", diet="vegan" if m.group(2) == "vegan" else "vegetarian")]))
    if re.search(r"\b(we eat meat|non-?veg(?:etarian)? is fine|not vegetarian anymore|no (?:longer|more) vegetarian|"
                 r"no diet(?:ary)? restrictions?)\b", low):
        return RouterResult("constraint_change", ChangeRequest(changes=[Change(kind="set_constraints", diet="none")]))
    if re.search(r"\b(?:don'?t|do not|no longer) need (?:step[- ]free|wheelchair|accessible)", low):
        return RouterResult("constraint_change", ChangeRequest(changes=[Change(kind="set_constraints", step_free=False)]))
    if re.search(r"\b(wheelchair|step[- ]free|can'?t (?:climb|do) (?:stairs|steps)|no stairs|stroller|pram)\b", low):
        return RouterResult("constraint_change", ChangeRequest(changes=[Change(kind="set_constraints", step_free=True)]))
    m = re.search(r"\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:of us|people|persons|"
                  r"travell?ers|adults|pax)\b", low)
    if m:
        count = int(m.group(1)) if m.group(1).isdigit() else WORD_NUM[m.group(1)]
        return RouterResult("constraint_change", ChangeRequest(changes=[Change(kind="set_constraints", travelers=count)]))
    if travelers and re.search(r"\b(one more (?:person|travell?er)|plus one|(?:friend|partner|wife|husband|brother|sister|"
                               r"colleague) is (?:joining|coming))\b", low):
        return RouterResult("constraint_change", ChangeRequest(changes=[Change(kind="set_constraints", travelers=travelers + 1)]))
    if re.search(r"\b(?:solo|just me|alone) now\b|\btravell?ing (?:solo|alone)\b", low):
        return RouterResult("constraint_change", ChangeRequest(changes=[Change(kind="set_constraints", travelers=1)]))

    # ---------------------------------------------------------------- day-level edits
    if re.search(r"\b(swap|switch|exchange|flip|trade|interchange)\b", low) and len(refs) >= 2 and \
            not _item_name_in(re.sub(r"\bdays?\s*\d+", " ", low), itin):
        return edit(Change(kind="swap_days", day=refs[0], to_day=refs[1]))
    if re.search(r"\b(clear|empty|wipe|free up|nothing (?:planned )?on|day off|rest day|lazy day|(?:remove|drop|cancel|delete) "
                 r"(?:everything|all(?: the)? (?:stops|activities|plans)))\b|\b(?:keep|make|leave)\b.*\bfree\b", low) \
            and not re.search(r"\b(step|gluten|sugar|dairy|cruelty)[- ]free\b", low):
        if day is None:
            return clarify("Which day should I clear?", itin, Change(kind="clear_day"), options=_day_options(itin))
        return edit(Change(kind="clear_day", day=day))
    m = re.search(r"\b(?:rename|call|name|title|label|theme)\s+(?:the\s+)?day\s*(\d+)\s*(?:to|as|:|-)?\s+(.+)$", text, re.I) or \
        re.search(r"\bday\s*(\d+)(?:'s)?\s+(?:theme|title|name)\s*(?:to|as|:|=|is|should be)\s*(.+)$", text, re.I) or \
        re.search(r"\bset\s+(?:the\s+)?(?:theme|title)\s+(?:of|for)\s+day\s*(\d+)\s*(?:to|as|:)?\s+(.+)$", text, re.I)
    if m:
        return edit(Change(kind="set_theme", day=int(m.group(1)) - 1, text=m.group(2).strip(" \"'“”‘’.")))

    # ---------------------------------------------------------------- lock state
    if re.search(r"\b(unlock|unpin|unfreeze|free to change|ok to change|okay to change)\b", low):
        name = _item_name_in(text, itin)
        return edit(Change(kind="unlock", place_name=name)) if name else \
            clarify("Which stop should I unlock?", itin, Change(kind="unlock"), options=[i.name for _, i in itin.all_items() if i.locked] or None)

    # ---------------------------------------------------------------- how long
    minutes = parse_duration(re.sub(r"\d{1,2}[:.]\d{2}", "", low))
    name = _item_name_in(text, itin) if minutes else None
    rest = low.replace(name.lower(), " ") if name else low  # "Le Marais Walk" is a stop, not a walk
    if minutes and re.search(r"\b(spend|stay|give|allow|allot|plan|need|want|make)\b|\b\d.*\b(?:at|in)\b", rest) and \
            not re.search(r"\b(add|book|include|travel|drive|commute|walk)\b", rest):
        ch = Change(kind="set_duration", place_name=name, duration_min=minutes, day=day)
        return edit(ch) if name else clarify(f"Where should I plan {minutes // 60}h{minutes % 60:02d}?", itin, ch, day=day)
    m = re.search(r"\b(longer|more time|extra time|less time|shorter|quicker|less long)\b", low)
    if m and not re.search(r"\b(trip|stay in|budget|travel)\b", low):
        name = _item_name_in(text, itin)
        if name:
            it = next(i for _, i in itin.all_items() if i.name == name)
            delta = 60 if m.group(1) in ("longer", "more time", "extra time") else -30
            return edit(Change(kind="set_duration", place_name=name, duration_min=max(15, it.end - it.start + delta)))

    # ---------------------------------------------------------------- move / retime
    start = parse_time(low)
    slot = parse_slot(low)
    to_day = _target_day(low, n)
    changing_place = re.search(r"\b(something|somewhere|another|different|instead|cheaper|indoors?|outdoors?|alternative)\b", low)
    meal_subject = re.match(r"^(?:(?:have|do|move|shift|push|pull|put|make|set)\s+)?(?:the\s+|my\s+|our\s+)?(lunch|dinner)\b", low)
    if meal_subject and (start is not None or to_day is not None) and not changing_place:
        meal_slot = meal_subject.group(1)
        if to_day is not None and re.search(r"\b(?:to|onto|into)\b", low) is None:
            to_day = None  # "lunch at 1pm on day 2": the day says which lunch, not where it goes
        src = _source_day(low, n) if to_day is not None else day
        meals = [(d, i) for d, i in itin.all_items() if i.slot == meal_slot and (src is None or d.index == src)]
        if len(meals) == 1:
            _, it = meals[0]
            return edit(Change(kind="move_item" if to_day is not None else "retime_item", place_name=it.name,
                               day=meals[0][0].index, to_day=to_day, start_min=start))
        if meals:
            ch = Change(kind="retime_item" if to_day is None else "move_item", to_day=to_day, start_min=start)
            return clarify(f"Which day's {meal_slot}?", itin, ch, options=[f"{i.name}" for _, i in meals][:8])
    if re.search(MOVE_VERB, low) and (to_day is not None or slot or start is not None or re.search(r"\b(earlier|later)\b", low)) \
            and not changing_place:
        name = _item_name_in(re.sub(rf"\b(?:to|on|onto|into|for)\s+(?:the\s+)?(?:day\s*\d+|{DAY_WORD}\s+day)\b", " ", text), itin)
        src = _source_day(low, n)
        if name is None and re.search(r"\b(the|my|our)\b", low):
            word = _vocab_hit(low)
            name = _category_item(low, itin, src) if word else None
        if name:
            it = next(i for _, i in itin.all_items() if i.name == name)
            if start is None and slot is None and to_day is None:
                start = max(0, min(23 * 60, it.start + (60 if "later" in low else -60)))
            kind_ = "move_item" if to_day is not None else "retime_item"
            return edit(Change(kind=kind_, place_name=name, day=src, to_day=to_day, slot=slot, start_min=start))
        if re.search(r"\b(move|shift|push|pull|reschedule|postpone|relocate|retime)\b", low):
            ch = Change(kind="move_item" if to_day is not None else "retime_item", to_day=to_day, slot=slot, start_min=start)
            return clarify("Which stop should I move?", itin, ch, day=_source_day(low, n))
    if re.search(r"\b(move|shift|reschedule|relocate)\b", low) and not changing_place:
        name = _item_name_in(text, itin)
        if name and to_day is None and slot is None and start is None:
            return clarify(f"Where should {name} go?", itin, Change(kind="move_item", place_name=name),
                           options=[*_day_options(itin), "Morning", "Afternoon", "Evening"])
    if (start is not None or slot) and not changing_place and not re.search(
            r"\b(add|include|remove|drop|delete|swap|replace|book|budget|rain|closed|start (?:the )?days?|days? start)\b", low):
        name = _item_name_in(text, itin)
        if name and re.match(rf"^(?:(?:do|visit|see|have|go to)\s+)?(?:the\s+)?{re.escape(name.lower()[:4])}", low):
            return edit(Change(kind="retime_item", place_name=name, slot=slot, start_min=start))
    return None


def complete_pending(pending: Change, message: str, itin: Itinerary) -> Change | None:
    """Fill the missing piece of a clarifying question from the traveller's answer, or None if it does not fit."""
    text, _ = strip_polite(message.strip())
    low = text.lower().strip(" .!?")
    n = len(itin.days)
    ch = pending.model_copy()
    if ch.kind in NEEDS_ITEM and not (ch.place_name or ch.item_id):
        name = next((it.name for _, it in itin.all_items() if it.name.lower() == low), None) or _item_name_in(text, itin)
        if not name:
            return None
        ch.place_name = name
        return ch
    refs = day_refs(low, n) or ([int(low) - 1] if low.isdigit() else [])
    if ch.kind == "move_item" and ch.to_day is None and ch.slot is None and ch.start_min is None:
        if refs:
            ch.to_day = refs[0]
            return ch
        slot = SLOT_MAP.get(low) or parse_slot(low)
        start = parse_time(low)
        if slot or start is not None:
            ch.kind, ch.slot, ch.start_min = "retime_item", slot, start
            return ch
        return None
    if ch.kind in ("add_custom", "clear_day", "set_theme") and ch.day is None:
        if not refs:
            return None
        ch.day = refs[0]
        return ch
    return None


def parse_message(message: str, itin: Itinerary, budget_inr: int, pace: str, *, travelers: int | None = None) -> RouterResult:
    text = message.strip()
    low = text.lower()

    m = re.match(r"^(what if|what would happen if|what happens if|suppose|how would (it|things) change if|"
                 r"what about if|and if|how about if)\b[\s,:-]*(.*)$", low)
    if m:
        inner = parse_message((m.group(3) or low).strip().rstrip("?.! "), itin, budget_inr, pace, travelers=travelers)
        if inner.request.changes:
            return RouterResult("whatif", inner.request)
        return RouterResult("chitchat", message="I could not turn that scenario into a change I can test. "
                            "Try something like “what if I reduce the budget by ₹10,000?” or “what if it rains on day 2?”.")

    clauses = split_clauses(text)
    if len(clauses) > 1:
        results = [_parse_clause(c, itin, budget_inr, pace, travelers) for c in clauses]
        changes = [ch for r in results for ch in r.request.changes]
        if changes:
            intents = {r.intent for r in results if r.request.changes}
            intent = "edit" if "edit" in intents else intents.pop()
            missed = [c for c, r in zip(clauses, results, strict=True) if not r.request.changes]
            note = (f"I did not understand “{'”, “'.join(missed)}”, so that part is not included." if missed else None)
            return RouterResult(intent, ChangeRequest(changes=changes), message=note)
    return _parse_clause(text, itin, budget_inr, pace, travelers)


def _parse_clause(message: str, itin: Itinerary, budget_inr: int, pace: str, travelers: int | None = None) -> RouterResult:
    text, commanded = strip_polite(message.strip())
    low = text.lower()
    n_days = len(itin.days)
    day = parse_day(low, n_days)
    changes: list[Change] = []

    crud = parse_crud(text, itin, travelers=travelers, commanded=commanded)
    if crud is not None:
        return crud

    # ------------------------------------------------------------------ budget
    amount = parse_amount(low) if re.search(r"budget|spend|cost|cheaper|afford|expens|₹|\brs\b|\binr\b|\bk\b|lakh", low) else None
    if re.search(r"\b(reduce|cut|lower|decrease|drop|trim|save|less|minus|shave)\b", low) and re.search(r"budget|spend|cost|₹|\brs\b|\binr\b", low) and amount:
        changes.append(Change(kind="budget_delta", amount_inr=-amount))
    elif re.search(r"\b(increase|raise|add|extra|more|bump)\b", low) and re.search(r"budget|spend|₹|\brs\b|\binr\b", low) and amount:
        changes.append(Change(kind="budget_delta", amount_inr=amount))
    elif re.search(r"budget (is|to|of|=|:)|set (the )?budget|new budget|total budget", low) and amount:
        changes.append(Change(kind="budget_set", amount_inr=amount))
    elif re.search(r"too expensive|too costly|cheaper|cheap(er)? option|save money|over budget", low) and not _vocab_hit(low):
        changes.append(Change(kind="budget_delta", amount_inr=-int(budget_inr * 0.15), note="Trim about 15%"))
    if changes:
        return RouterResult("constraint_change" if "?" not in low else "whatif", ChangeRequest(changes=changes))

    # ------------------------------------------------------------------ weather / closures
    if re.search(r"\b(rain|rains|raining|rainy|storm|storms|monsoon|wet)\b", low) and not re.search(r"\b(ask|question)\b", low):
        return RouterResult("edit", ChangeRequest(changes=[Change(kind="weather", day=day)]))
    if re.search(r"\b(closed|shut|sold out|unavailable|fully booked|cancelled|canceled)\b", low):
        name = _item_name_in(text, itin) or _category_item(low, itin, day)
        if name:
            return RouterResult("edit", ChangeRequest(changes=[Change(kind="closure", place_name=name, day=day)]))
        return clarify("Which stop is closed?", itin, Change(kind="closure", day=day), day=day)

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
        return clarify("Which stop should I swap?", itin, Change(kind="replace_item", day=day, interest=target_interest,
                                                                 indoor=indoor, cheaper=cheaper), day=day)

    if verb_avoid and interest:
        return RouterResult("edit", ChangeRequest(changes=[Change(kind="avoid", interest=interest)]))

    if verb_remove:
        name = _item_name_in(text, itin, day) or (_category_item(low, itin, day) if day is not None else None)
        if name:
            return RouterResult("edit", ChangeRequest(changes=[Change(kind="remove_item", place_name=name, day=day)]))
        if interest and (interest in CATEGORY_WORDS or interest in ("shopping", "nightlife")):
            if day is None:
                return RouterResult("edit", ChangeRequest(changes=[Change(kind="avoid", interest=interest)]))
            item = _category_item(low, itin, day)
            if item:
                return RouterResult("edit", ChangeRequest(changes=[Change(kind="remove_item", place_name=item, day=day)]))
        return clarify("Which stop should I remove?", itin, Change(kind="remove_item", day=day), day=day)

    if verb_lock:
        name = _item_name_in(text, itin)
        if name:
            return RouterResult("edit", ChangeRequest(changes=[Change(kind="lock", place_name=name)]))

    named = _named_target(text) if re.search(ADD_PLACE_VERB, low) else None
    if named:
        return RouterResult("edit", ChangeRequest(changes=[Change(
            kind="add_place", place_name=named, day=day, slot=parse_slot(low), start_min=parse_time(low), interest=interest)]))

    if verb_add and interest:
        if re.search(r"\bmore\b|\bprefer\b|\blove\b", low) and not re.search(r"\badd\b|\binclude\b", low):
            return RouterResult("edit", ChangeRequest(changes=[Change(kind="prefer", interest=interest)]))
        return RouterResult("edit", ChangeRequest(changes=[Change(kind="add_item", interest=interest, day=day,
                                                                   note=f"You asked for {interest}")]))

    return RouterResult(
        "chitchat",
        message="I can add, move, retime, swap or remove stops, add your own entries (a flight, a check-in), clear or swap "
                "days, add notes, change the pace or budget, or re-plan for rain. Try “move Amber Fort to day 3”, "
                "“add a flight at 18:00 on the last day” or “what if I reduce my budget by ₹10,000?”.",
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
