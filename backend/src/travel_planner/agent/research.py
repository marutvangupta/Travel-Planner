"""Research step: gather candidates, travel times, weather and guide passages into a PlanContext.

This is code-driven and parallel on purpose: it is cheaper, faster and more predictable than letting an LLM
decide which tools to call, and it makes every run reproducible from the tool cache.
"""

from __future__ import annotations

import asyncio
import re
from datetime import date

from ..config import get_settings
from ..schemas import Constraints, GuideChunk, Itinerary, TripRequest
from ..services.context import PlanContext, transport_for
from ..tools import core
from .tool_client import ToolClient

GUIDE_QUERIES = {
    "culture": "cultural etiquette and customs", "history": "historic sites opening times and tickets",
    "food": "local food and what to eat", "nature": "best time to visit weather and nature",
    "adventure": "adventure activities safety", "shopping": "markets shopping bargaining",
    "nightlife": "nightlife safety and late transport", "relaxation": "relaxing places calm",
    "art": "museums art closed days", "architecture": "architecture sights",
}


def constraints_from_request(req: TripRequest) -> Constraints:
    return Constraints(
        diet=req.diet, step_free=req.step_free, avoid=[a.lower() for a in req.avoid],
        day_start_min=10 * 60 + 30 if req.late_starts else 9 * 60, notes=req.constraints_text,
    )


def apply_text_rules(req: TripRequest) -> TripRequest:
    """Rule-based intake: pull structured constraints out of the free-text box (an LLM can do this too)."""
    t = req.constraints_text.lower()
    patch: dict = {}
    if re.search(r"\bvegan\b", t):
        patch["diet"] = "vegan"
    elif re.search(r"\bveg(etarian|)\b|\bno meat\b|\bpure veg\b", t) and req.diet == "none":
        patch["diet"] = "vegetarian"
    if re.search(r"wheelchair|step[- ]free|mobility|can'?t (climb|walk) (stairs|much)|no stairs", t):
        patch["step_free"] = True
    if re.search(r"no early|late start|sleep in|start late|not a morning", t):
        patch["late_starts"] = True
    avoid = list(req.avoid)
    for m in re.finditer(r"(?:avoid|no|skip|hate|dislike)\s+(museums?|temples?|forts?|shopping|nightlife|beaches|markets?|crowds?)", t):
        word = m.group(1).rstrip("s") if m.group(1) not in ("shopping", "nightlife") else m.group(1)
        if word not in ("crowd",) and word not in avoid:
            avoid.append(word)
    if avoid != list(req.avoid):
        patch["avoid"] = avoid
    return req.model_copy(update=patch) if patch else req


async def build_context(req: TripRequest, tools: ToolClient, *, weights: dict[str, float] | None = None,
                        constraints: Constraints | None = None) -> PlanContext:
    settings = get_settings()
    geo = await tools.geocode(req.destination)
    places = await tools.search_places(req.destination, geo.lat, geo.lng, req.interests)
    base = (geo.lat, geo.lng)
    points = [base] + [(p.lat, p.lng) for p in places]

    guide_queries = ["getting around local transport", "best time to visit weather", "safety tips etiquette"]
    guide_queries += [GUIDE_QUERIES[i] for i in req.interests if i in GUIDE_QUERIES]

    async def guides() -> list[GuideChunk]:
        try:
            batches = await asyncio.gather(*(tools.guides(req.destination, q, 2) for q in guide_queries))
        except Exception:
            return []  # guides are an enhancement; the plan still works without them
        seen: dict[str, GuideChunk] = {}
        for batch in batches:
            for c in batch:
                seen.setdefault(c.chunk_id, c)
        return list(seen.values())[:12]

    matrix, weather_days, guide_chunks = await asyncio.gather(
        tools.route_matrix(points),
        tools.weather(geo.lat, geo.lng, req.start_date.isoformat(), req.end_date.isoformat()),
        guides(),
    )
    weather = {}
    for w in weather_days:
        idx = (date.fromisoformat(w.date) - req.start_date).days
        if 0 <= idx < req.num_days:
            weather[idx] = w
    index = {"__base__": 0}
    for i, p in enumerate(places, start=1):
        index[p.place_id] = i

    ctx = PlanContext(
        request=req, constraints=constraints or constraints_from_request(req), geo=geo,
        places={p.place_id: p for p in places}, matrix=matrix, index=index, base=base, weather=weather,
        transport=transport_for(geo), weights=dict(weights or {}), guides=guide_chunks,
        data_mode="live" if settings.google_enabled else "demo", rain_threshold=settings.rain_threshold_pct,
        route_source="google-routes" if settings.google_enabled else "estimated",
    )
    for p in places:
        ctx.sources[p.source.id] = p.source
    for g in guide_chunks:
        src = core.guide_source(g)
        ctx.sources[src.id] = src
    for w in weather.values():
        if w.source:
            ctx.sources[w.source.id] = w.source
    return ctx


async def register_user_places(ctx: PlanContext, itin: Itinerary, tools: ToolClient | None = None) -> None:
    """Custom entries live in the itinerary; places added by name are re-fetched by id (only ids are stored)."""
    for p in itin.custom_places.values():
        ctx.register_place(p)
    missing = [pid for pid in itin.extra_place_ids if pid not in ctx.places]
    if missing:
        from .tool_client import get_tools

        try:
            for p in await (tools or get_tools()).place_details(missing):
                ctx.register_place(p, extra=True)
        except Exception:  # a stop that cannot be refreshed is reported by the validator as unknown
            pass
    ctx.extra_ids |= {pid for pid in itin.extra_place_ids if pid in ctx.places}
