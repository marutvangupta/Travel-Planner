"""Google Maps Platform adapters: Geocoding, Places API (New), Routes API.

Responses are normalised to our own models; raw Google JSON never leaves this module.
Google content is cached only briefly (see the TTLs in tools/core.py) to respect the Platform terms.
"""

from __future__ import annotations

from ...config import get_settings
from ...schemas import Geo, Hours, Place, RouteCell, Source
from ..common import ToolFailure, http_json, now_iso

PLACES_SEARCH = "https://places.googleapis.com/v1/places:searchText"
PLACES_DETAIL = "https://places.googleapis.com/v1/places/"
ROUTES_MATRIX = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
GEOCODE = "https://maps.googleapis.com/maps/api/geocode/json"

SEARCH_MASK = ",".join([
    "places.id", "places.displayName", "places.location", "places.rating", "places.priceLevel",
    "places.types", "places.primaryType", "places.regularOpeningHours", "places.businessStatus",
    "places.editorialSummary", "places.googleMapsUri", "places.accessibilityOptions",
    "places.servesVegetarianFood", "places.shortFormattedAddress",
])

# interest -> text queries
INTEREST_QUERIES: dict[str, list[str]] = {
    "culture": ["top cultural attractions", "traditional cultural experience"],
    "history": ["historic sites and forts", "heritage landmarks"],
    "food": ["best local restaurants", "famous street food"],
    "nature": ["parks and gardens", "scenic nature spots"],
    "adventure": ["adventure activities", "viewpoints and hikes"],
    "shopping": ["local markets", "handicraft shopping"],
    "nightlife": ["nightlife bars", "evening entertainment"],
    "relaxation": ["relaxing spots", "spa and wellness"],
    "art": ["art museums and galleries"],
    "architecture": ["architectural landmarks"],
}

# google type -> (category, tags, indoor, duration_min, food)
TYPE_MAP: dict[str, tuple[str, list[str], bool, int, bool]] = {
    "museum": ("museum", ["art", "history", "culture"], True, 90, False),
    "art_gallery": ("gallery", ["art", "culture"], True, 60, False),
    "tourist_attraction": ("attraction", ["culture"], False, 75, False),
    "historical_landmark": ("monument", ["history", "architecture"], False, 60, False),
    "church": ("church", ["history", "architecture", "culture"], True, 45, False),
    "hindu_temple": ("temple", ["culture", "history"], False, 45, False),
    "place_of_worship": ("temple", ["culture"], False, 45, False),
    "park": ("park", ["nature", "relaxation"], False, 75, False),
    "national_park": ("park", ["nature", "adventure"], False, 120, False),
    "beach": ("beach", ["relaxation", "nature"], False, 120, False),
    "shopping_mall": ("market", ["shopping"], True, 90, False),
    "market": ("market", ["shopping", "culture"], False, 90, False),
    "night_club": ("nightlife", ["nightlife"], True, 120, False),
    "bar": ("bar", ["nightlife"], True, 90, False),
    "spa": ("spa", ["relaxation"], True, 90, False),
    "amusement_park": ("activity", ["adventure"], False, 180, False),
    "restaurant": ("restaurant", ["food"], True, 60, True),
    "cafe": ("cafe", ["food"], True, 45, True),
    "bakery": ("cafe", ["food"], True, 30, True),
}

PRICE_LEVEL = {
    "PRICE_LEVEL_FREE": 0, "PRICE_LEVEL_INEXPENSIVE": 1, "PRICE_LEVEL_MODERATE": 2,
    "PRICE_LEVEL_EXPENSIVE": 3, "PRICE_LEVEL_VERY_EXPENSIVE": 4,
}
FOOD_COST = {None: 700, 0: 0, 1: 350, 2: 800, 3: 2000, 4: 5000}
ATTRACTION_COST = {None: 300, 0: 0, 1: 250, 2: 600, 3: 1500, 4: 3500}


def _headers(mask: str | None = None) -> dict[str, str]:
    h = {"X-Goog-Api-Key": get_settings().google_maps_api_key or "", "Content-Type": "application/json"}
    if mask:
        h["X-Goog-FieldMask"] = mask
    return h


async def geocode(destination: str) -> Geo:
    data = await http_json("GET", GEOCODE, params={"address": destination, "key": get_settings().google_maps_api_key})
    if data.get("status") != "OK" or not data.get("results"):
        raise ToolFailure("destination_not_found", f"Could not geocode {destination!r} ({data.get('status')})")
    r = data["results"][0]
    country = next((c["long_name"] for c in r["address_components"] if "country" in c["types"]), None)
    loc = r["geometry"]["location"]
    return Geo(
        name=r["formatted_address"], lat=loc["lat"], lng=loc["lng"], country=country,
        source=Source(id=f"gplaces:geo:{r.get('place_id', destination)}", provider="google-geocoding",
                      title=r["formatted_address"], retrieved_at=now_iso()),
    )


def _hours(raw: dict | None) -> Hours | None:
    if not raw or "periods" not in raw:
        return None
    periods = raw["periods"]
    out: Hours = {d: [] for d in range(7)}
    if len(periods) == 1 and "close" not in periods[0]:  # open 24/7
        return {d: [(0, 1440)] for d in range(7)}
    for p in periods:
        o, c = p.get("open"), p.get("close")
        if not o or not c:
            continue
        day = (o["day"] + 6) % 7  # Google: 0=Sunday -> ours: 0=Monday
        start = o.get("hour", 0) * 60 + o.get("minute", 0)
        end = c.get("hour", 0) * 60 + c.get("minute", 0)
        if c["day"] != o["day"] or end <= start:
            end = 1440
        out[day].append((start, end))
    return out


def _normalise(p: dict) -> Place | None:
    types = p.get("types", [])
    primary = p.get("primaryType")
    chosen = None
    for t in ([primary] if primary else []) + types:
        if t in TYPE_MAP:
            chosen = TYPE_MAP[t]
            break
    if not chosen:
        chosen = ("attraction", ["culture"], False, 60, False)
    category, tags, indoor, duration, is_food = chosen
    level = PRICE_LEVEL.get(p.get("priceLevel", ""), None)
    cost = (FOOD_COST if is_food else ATTRACTION_COST).get(level, 300)
    loc = p.get("location")
    if not loc:
        return None
    diet = ["vegetarian"] if p.get("servesVegetarianFood") else []
    acc = (p.get("accessibilityOptions") or {}).get("wheelchairAccessibleEntrance")
    pid = f"gplaces:{p['id']}"
    return Place(
        place_id=pid, name=(p.get("displayName") or {}).get("text", "Unknown"), category=category, tags=list(tags),
        lat=loc["latitude"], lng=loc["longitude"], rating=p.get("rating"), price_level=level, cost_inr=cost,
        duration_min=duration, indoor=indoor, hours=_hours(p.get("regularOpeningHours")),
        business_status=p.get("businessStatus", "OPERATIONAL"), step_free=acc, diet_tags=diet,
        description=(p.get("editorialSummary") or {}).get("text", ""), area=p.get("shortFormattedAddress"),
        source=Source(id=pid, provider="google-places", title=(p.get("displayName") or {}).get("text", ""),
                      url=p.get("googleMapsUri"), retrieved_at=now_iso()),
    )


async def search_text(query: str, lat: float, lng: float, radius_m: int, max_results: int) -> list[Place]:
    body = {
        "textQuery": query, "maxResultCount": max(1, min(max_results, 20)),
        "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": float(radius_m)}},
    }
    data = await http_json("POST", PLACES_SEARCH, headers=_headers(SEARCH_MASK), json=body)
    places = [_normalise(p) for p in data.get("places", [])]
    return [p for p in places if p and p.business_status == "OPERATIONAL"]


async def place_details(place_id: str) -> Place | None:
    raw_id = place_id.removeprefix("gplaces:")
    mask = SEARCH_MASK.replace("places.", "")
    data = await http_json("GET", PLACES_DETAIL + raw_id, headers=_headers(mask))
    return _normalise(data)


async def route_matrix(points: list[tuple[float, float]]) -> list[list[RouteCell]]:
    n = len(points)
    waypoints = [
        {"waypoint": {"location": {"latLng": {"latitude": la, "longitude": ln}}}} for la, ln in points
    ]
    cells: list[list[RouteCell | None]] = [[None] * n for _ in range(n)]
    chunk = max(1, 600 // n)  # Routes API caps elements per request
    mask = "originIndex,destinationIndex,duration,distanceMeters,status,condition"
    for start in range(0, n, chunk):
        origins = waypoints[start : start + chunk]
        body = {
            "origins": origins, "destinations": waypoints, "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_UNAWARE",
        }
        rows = await http_json("POST", ROUTES_MATRIX, headers=_headers(mask), json=body, timeout=15.0)
        for r in rows if isinstance(rows, list) else [rows]:
            i, j = start + r.get("originIndex", 0), r.get("destinationIndex", 0)
            if r.get("condition") != "ROUTE_EXISTS":
                continue
            seconds = int(str(r.get("duration", "0s")).rstrip("s") or 0)
            meters = int(r.get("distanceMeters", 0))
            if i == j:
                cells[i][j] = RouteCell(minutes=0, meters=0, mode="walk")
            elif meters <= 1800:  # short hops are walked; saves a second API call
                cells[i][j] = RouteCell(minutes=max(2, round(meters / 80)), meters=meters, mode="walk")
            else:
                cells[i][j] = RouteCell(minutes=max(3, round(seconds / 60) + 5), meters=meters, mode="drive")
    # any pair Google could not route falls back to straight-line estimates
    from ..common import haversine_km

    for i in range(n):
        for j in range(n):
            if cells[i][j] is None:
                km = haversine_km(*points[i], *points[j]) * 1.4
                cells[i][j] = RouteCell(minutes=round(10 + km / 22 * 60), meters=int(km * 1000), mode="drive")
    return cells  # type: ignore[return-value]
