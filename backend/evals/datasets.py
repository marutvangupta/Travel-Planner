"""Golden datasets for the eval suite. Kept in code so they are versioned, diffable and importable by tests."""

from __future__ import annotations

from datetime import date, timedelta

from travel_planner.schemas import TripRequest

DESTINATIONS = {"Jaipur, India": 4000, "Goa, India": 5500, "Tokyo, Japan": 11000, "Paris, France": 12000}  # INR per person-day

# (name, days, travelers, interests, pace, extras, budget multiplier)
PROFILES = [
    ("classic", 3, 2, ["history", "food"], "balanced", {}, 1.0),
    ("slow-nature", 4, 1, ["nature", "relaxation"], "relaxed", {"diet": "vegetarian"}, 0.95),
    ("shoppers", 2, 4, ["shopping", "food", "culture"], "packed", {}, 1.3),
    ("access-art", 3, 2, ["art", "architecture"], "balanced", {"step_free": True}, 1.0),
    ("night-owls", 3, 2, ["nightlife", "food"], "balanced", {"avoid": ["museum"], "late_starts": True}, 1.1),
    ("vegan-adventure", 3, 3, ["adventure", "nature"], "packed", {"diet": "vegan"}, 1.1),
]


def trip_cases(limit: int | None = None) -> list[tuple[str, TripRequest]]:
    out: list[tuple[str, TripRequest]] = []
    start = date(2026, 11, 9)
    for dest, pp_day in DESTINATIONS.items():
        for name, days, travelers, interests, pace, extra, mult in PROFILES:
            req = TripRequest(
                destination=dest, start_date=start, end_date=start + timedelta(days=days - 1),
                budget_inr=int(pp_day * days * travelers * mult), travelers=travelers, interests=interests, pace=pace, **extra,
            )
            out.append((f"{dest.split(',')[0].lower()}/{name}", req))
    return out[:limit] if limit else out


# Each change case is (kind, builder). `msg(base)` produces the natural-language message from the base plan.
CHANGE_KINDS = ["rain", "closure", "budget_cut", "avoid", "pace", "late_start"]


def smoke_cases() -> list[tuple[str, TripRequest]]:
    keep = {"jaipur/classic", "goa/slow-nature", "tokyo/access-art", "paris/vegan-adventure", "jaipur/night-owls"}
    return [c for c in trip_cases() if c[0] in keep]


# Retrieval: (destination, query, relevant chunk ids). Chunk ids are "<destination>-<index in GUIDES>".
RETRIEVAL: list[tuple[str, str, set[str]]] = [
    ("Jaipur", "how do I get between the forts and the old city", {"jaipur-0"}),
    ("Jaipur", "which months are cool and dry versus unbearably hot", {"jaipur-1"}),
    ("Jaipur", "what time should I reach Amber Fort to avoid the crowds", {"jaipur-2"}),
    ("Jaipur", "vegetarian thali and street snacks to try", {"jaipur-3"}),
    ("Jaipur", "where to buy block printed textiles and how hard to bargain", {"jaipur-4"}),
    ("Jaipur", "dress code at palaces and the elephant ride welfare issue", {"jaipur-5"}),
    ("Goa", "should I rent a scooter or take taxis", {"goa-0"}),
    ("Goa", "when are the beach shacks open and is the sea safe", {"goa-1"}),
    ("Goa", "how to visit the waterfall and the forts", {"goa-2"}),
    ("Goa", "what to eat if I do not eat seafood", {"goa-3"}),
    ("Goa", "where are the clubs and how to get home safely", {"goa-4"}),
    ("Goa", "which day does the flea market run", {"goa-5"}),
    ("Tokyo", "best card for trains and buses and when they stop running", {"tokyo-0"}),
    ("Tokyo", "cherry blossom season and typhoon risk", {"tokyo-1"}),
    ("Tokyo", "museums that are shut on Mondays and timed tickets", {"tokyo-2"}),
    ("Tokyo", "vegan ramen and soup stock made from fish", {"tokyo-3"}),
    ("Tokyo", "is tipping expected and eating while walking", {"tokyo-4"}),
    ("Tokyo", "earthquake preparedness", {"tokyo-6"}),
    ("Paris", "Metro tickets and passes", {"paris-0"}),
    ("Paris", "best months to visit and when restaurants close", {"paris-1"}),
    ("Paris", "which museums close on Tuesday or Monday", {"paris-2"}),
    ("Paris", "vegetarian friendly places to eat", {"paris-3"}),
    ("Paris", "pickpockets and tourist scams", {"paris-5"}),
    ("Paris", "is a museum pass worth the money", {"paris-6"}),
]
