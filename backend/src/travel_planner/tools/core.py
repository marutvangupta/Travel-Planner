"""Tool functions: the single source of truth for external data. The MCP server is a thin wrapper over these.

Every function returns JSON-serialisable dicts built from the normalised models in schemas.py.
"""

from __future__ import annotations

import asyncio
from datetime import date

from ..config import get_settings
from ..schemas import DayWeather, Geo, GuideChunk, Place, RouteCell, Source
from ..services import rag
from .common import ToolFailure, now_iso, run_tool
from .demo_data import FX_TO_INR
from .providers import demo, google, open_meteo
from .providers import frankfurter as fx

TTL_GEO = 24 * 3600
TTL_SUGGEST = 24 * 3600
TTL_PLACES = 3600  # Google content: keep short, persist only place_id
TTL_ROUTES = 6 * 3600
TTL_WEATHER = 3600
TTL_FX = 6 * 3600


def data_mode() -> str:
    return "live" if get_settings().google_enabled else "demo"


async def geocode(destination: str) -> dict:
    async def fn() -> dict:
        geo = await google.geocode(destination) if get_settings().google_enabled else demo.geocode(destination)
        return geo.model_dump(mode="json")

    return await run_tool("geocode", {"d": destination.lower(), "m": data_mode()}, TTL_GEO, fn)


async def suggest_destinations(query: str, limit: int = 6) -> dict:
    """Destination suggestions while typing: the supported cities in demo mode, Google city autocomplete when live."""
    q = " ".join(query.split())[:80]
    if not get_settings().google_enabled:
        return {"suggestions": demo.suggest(q)[:limit], "mode": "demo"}
    if len(q) < 2:
        return {"suggestions": [], "mode": "live"}

    async def fn() -> dict:
        return {"suggestions": await google.autocomplete_cities(q, limit), "mode": "live"}

    return await run_tool("suggest_destinations", {"q": q.lower(), "n": limit}, TTL_SUGGEST, fn)


async def search_places(
    destination: str, lat: float, lng: float, interests: list[str] | None = None, max_results: int = 40,
    radius_m: int = 15000,
) -> dict:
    interests = sorted(interests or [])

    async def fn() -> dict:
        if not get_settings().google_enabled:
            places = demo.all_places(destination)
            return {"places": [p.model_dump(mode="json") for p in places[:max_results]], "mode": "demo"}
        queries: list[str] = ["top tourist attractions"]
        for interest in interests or ["culture", "food", "nature"]:
            queries.extend(google.INTEREST_QUERIES.get(interest, [])[:2])
        if "food" not in interests:
            queries.append("best local restaurants")  # lunch / dinner slots need food candidates
        results = await asyncio.gather(
            *(google.search_text(f"{q} in {destination}", lat, lng, radius_m, 12) for q in queries),
            return_exceptions=True,
        )
        merged: dict[str, Place] = {}
        failures = 0
        for r in results:
            if isinstance(r, Exception):
                failures += 1
                continue
            for p in r:
                merged.setdefault(p.place_id, p)
        if not merged:
            raise ToolFailure("no_places", f"No places returned for {destination!r}", retryable=failures > 0)
        ranked = sorted(merged.values(), key=lambda p: -(p.rating or 0))[:max_results]
        return {"places": [p.model_dump(mode="json") for p in ranked], "mode": "live", "partial_failures": failures}

    return await run_tool(
        "search_places",
        {"d": destination.lower(), "i": interests, "n": max_results, "m": data_mode(), "r": radius_m},
        TTL_PLACES, fn,
    )


async def get_place_details(place_ids: list[str]) -> dict:
    async def fn() -> dict:
        if not get_settings().google_enabled:
            return {"places": [p.model_dump(mode="json") for p in demo.get_places(place_ids)]}
        got = await asyncio.gather(*(google.place_details(pid) for pid in place_ids), return_exceptions=True)
        return {"places": [p.model_dump(mode="json") for p in got if isinstance(p, Place)]}

    return await run_tool("get_place_details", {"ids": sorted(place_ids), "m": data_mode()}, TTL_PLACES, fn)


async def compute_route_matrix(points: list[tuple[float, float]]) -> dict:
    pts = [(round(a, 5), round(b, 5)) for a, b in points]

    async def fn() -> dict:
        if get_settings().google_enabled:
            try:
                cells = await google.route_matrix(pts)
                source = "google-routes"
            except Exception:
                cells, source = demo.route_matrix(pts), "estimated"
        else:
            cells, source = demo.route_matrix(pts), "estimated"
        return {"matrix": [[c.model_dump() for c in row] for row in cells], "source": source}

    return await run_tool("compute_route_matrix", {"p": pts, "m": data_mode()}, TTL_ROUTES, fn)


async def get_weather_forecast(lat: float, lng: float, start: str, end: str) -> dict:
    s, e = date.fromisoformat(start), date.fromisoformat(end)

    async def fn() -> dict:
        days: list[DayWeather]
        if not get_settings().force_demo and open_meteo.in_forecast_window(s, e):
            try:
                days = await open_meteo.forecast(lat, lng, s, e)
            except Exception:
                days = demo.weather(lat, lng, s, e)
        else:
            days = demo.weather(lat, lng, s, e)
        return {"days": [d.model_dump(mode="json") for d in days]}

    return await run_tool(
        "get_weather_forecast",
        {"lat": round(lat, 2), "lng": round(lng, 2), "s": start, "e": end, "demo": get_settings().force_demo},
        TTL_WEATHER, fn,
    )


async def convert_currency(amount: float, from_ccy: str, to_ccy: str = "INR") -> dict:
    from_ccy, to_ccy = from_ccy.upper(), to_ccy.upper()

    async def fn() -> dict:
        if from_ccy == to_ccy:
            return {"amount": amount, "converted": amount, "rate": 1.0, "as_of": now_iso(), "provider": "identity"}
        try:
            if get_settings().force_demo:
                raise RuntimeError("demo")
            rate, as_of = await fx.rate(from_ccy, to_ccy)
            provider = "frankfurter"
        except Exception:
            if from_ccy not in FX_TO_INR or to_ccy not in FX_TO_INR:
                raise ToolFailure("unsupported_currency", f"No offline rate for {from_ccy}->{to_ccy}") from None
            rate, as_of, provider = FX_TO_INR[from_ccy] / FX_TO_INR[to_ccy], "static", "offline-table"
        return {"amount": amount, "converted": round(amount * rate, 2), "rate": rate, "as_of": as_of, "provider": provider}

    return await run_tool("convert_currency", {"a": amount, "f": from_ccy, "t": to_ccy}, TTL_FX, fn)


async def search_travel_guides(destination: str, query: str, k: int = 4, mode: str = "hybrid") -> dict:
    async def fn() -> dict:
        chunks = await asyncio.to_thread(rag.search, destination, query, k, mode)
        return {"chunks": [c.model_dump(mode="json") for c in chunks]}

    return await run_tool("search_travel_guides", {"d": destination.lower(), "q": query, "k": k, "mode": mode}, 600, fn)


# ---------------------------------------------------------------------------------------------- typed accessors


def places_from(payload: dict) -> list[Place]:
    return [Place.model_validate(p) for p in payload.get("places", [])]


def geo_from(payload: dict) -> Geo:
    return Geo.model_validate(payload)


def matrix_from(payload: dict) -> list[list[RouteCell]]:
    return [[RouteCell.model_validate(c) for c in row] for row in payload["matrix"]]


def weather_from(payload: dict) -> list[DayWeather]:
    return [DayWeather.model_validate(d) for d in payload.get("days", [])]


def guides_from(payload: dict) -> list[GuideChunk]:
    return [GuideChunk.model_validate(c) for c in payload.get("chunks", [])]


def guide_source(chunk: GuideChunk) -> Source:
    return Source(id=f"guide:{chunk.chunk_id}", provider=chunk.provider, title=f"{chunk.destination.title()} guide: {chunk.section}",
                  url=chunk.url, retrieved_at=now_iso())
