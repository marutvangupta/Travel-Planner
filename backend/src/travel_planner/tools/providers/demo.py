"""Offline provider backed by demo_data.py. Same normalized outputs as the live providers."""

from __future__ import annotations

import hashlib
import math
from datetime import date, timedelta

from ...schemas import DayWeather, Geo, Place, RouteCell, Source
from ..common import ToolFailure, haversine_km, now_iso
from ..demo_data import DESTINATIONS, PLACES, parse_hours


def resolve_key(destination: str) -> str | None:
    q = destination.strip().lower()
    for key, meta in DESTINATIONS.items():
        if any(a in q for a in meta["aliases"]):
            return key
    return None


def supported_destinations() -> list[str]:
    return [m["name"] for m in DESTINATIONS.values()]


def geocode(destination: str) -> Geo:
    key = resolve_key(destination)
    if not key:
        raise ToolFailure(
            "destination_unsupported_in_demo",
            f"Demo mode covers: {', '.join(supported_destinations())}. Add a Google Maps API key for other cities.",
        )
    m = DESTINATIONS[key]
    return Geo(
        name=m["name"], lat=m["lat"], lng=m["lng"], country=m["country"], currency=m["currency"],
        source=Source(id=f"demo:geo:{key}", provider="demo-dataset", title=m["name"], retrieved_at=now_iso()),
    )


def _row_to_place(key: str, row: tuple) -> Place:
    (slug, name, category, tags, lat, lng, rating, price_level, cost, duration, indoor, hours, step_free,
     diet_tags, area, desc) = row
    pid = f"demo:{key}:{slug}"
    return Place(
        place_id=pid, name=name, category=category, tags=list(tags), lat=lat, lng=lng, rating=rating,
        price_level=price_level, cost_inr=cost, duration_min=duration, indoor=indoor,
        hours=parse_hours(hours), step_free=step_free, diet_tags=list(diet_tags), description=desc, area=area,
        source=Source(
            id=pid, provider="demo-dataset", title=name, url=None, retrieved_at=now_iso(),
        ),
    )


def all_places(destination: str) -> list[Place]:
    key = resolve_key(destination)
    if not key:
        raise ToolFailure("destination_unsupported_in_demo", f"No demo data for {destination!r}")
    return [_row_to_place(key, row) for row in PLACES[key]]


def get_places(place_ids: list[str]) -> list[Place]:
    wanted = set(place_ids)
    out: list[Place] = []
    for key, rows in PLACES.items():
        for row in rows:
            pid = f"demo:{key}:{row[0]}"
            if pid in wanted:
                out.append(_row_to_place(key, row))
    return out


def route_matrix(points: list[tuple[float, float]]) -> list[list[RouteCell]]:
    """Haversine with a 1.3 road factor. Walk under ~1.8 km; otherwise 8 min overhead, 20 km/h for the first
    5 km (city traffic) and 35 km/h beyond."""
    n = len(points)
    out: list[list[RouteCell]] = []
    for i in range(n):
        row: list[RouteCell] = []
        for j in range(n):
            if i == j:
                row.append(RouteCell(minutes=0, meters=0, mode="walk"))
                continue
            km = haversine_km(*points[i], *points[j]) * 1.3
            if km <= 1.8:
                row.append(RouteCell(minutes=max(2, round(km / 4.8 * 60)), meters=int(km * 1000), mode="walk"))
            else:
                row.append(RouteCell(minutes=round(8 + min(km, 5) / 20 * 60 + max(km - 5, 0) / 35 * 60),
                                     meters=int(km * 1000), mode="drive"))
        out.append(row)
    return out


def _seed(*parts: object) -> float:
    h = hashlib.sha256("|".join(str(p) for p in parts).encode()).digest()
    return int.from_bytes(h[:4], "big") / 0xFFFFFFFF


def weather(lat: float, lng: float, start: date, end: date) -> list[DayWeather]:
    """Deterministic synthetic climatology (clearly labelled as such)."""
    out: list[DayWeather] = []
    d = start
    while d <= end:
        month = d.month
        monsoon = lat < 30 and lng > 68 and lng < 90 and month in (6, 7, 8, 9)
        base_rain = 62 if monsoon else 18
        noise = _seed("rain", round(lat, 1), round(lng, 1), d.isoformat())
        prob = int(max(0, min(100, base_rain + (noise - 0.5) * 70 + (25 if noise > 0.85 else 0))))
        hot = lat < 30 and month in (4, 5, 6)
        tmax = round(18 + 14 * math.sin((month - 3) / 12 * 2 * math.pi) + (8 if hot else 0)
                     + (_seed("t", d.isoformat(), lat) - 0.5) * 4, 1) if abs(lat) > 20 else round(
            30 + (_seed("t", d.isoformat(), lat) - 0.5) * 6, 1)
        condition = "rain" if prob >= 60 else ("hot" if tmax >= 38 else ("cloudy" if prob >= 35 else "clear"))
        out.append(DayWeather(
            date=d.isoformat(), precip_prob=prob, temp_min=round(tmax - 9, 1), temp_max=tmax, condition=condition,
            source=Source(id=f"meteo:{round(lat,2)},{round(lng,2)}:{d.isoformat()}", provider="synthetic-climatology",
                          title="Synthetic climatology (demo)", retrieved_at=now_iso()),
        ))
        d += timedelta(days=1)
    return out
