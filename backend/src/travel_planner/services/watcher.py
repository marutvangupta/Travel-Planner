"""Weather watcher: re-checks forecasts for upcoming trips and proposes a re-plan when a day turns rainy.

Runs as a background asyncio task (no queue needed at this scale). Proposals are never applied automatically;
the traveller reviews the diff and accepts or rejects it.
"""

from __future__ import annotations

import asyncio
from datetime import date

import structlog
from sqlalchemy import select

from ..config import get_settings
from ..db import session_scope
from ..models import ChangeEvent, Trip, User
from ..schemas import Change, ChangeRequest
from .orchestrator import current_itinerary, propose_change

log = structlog.get_logger()


async def check_trip(trip_id: str) -> str | None:
    """Return the new ChangeEvent id if a proposal was created."""
    from ..agent.tool_client import get_tools

    with session_scope() as db:
        trip = db.get(Trip, trip_id)
        if not trip or trip.end_date < date.today():
            return None
        user = db.get(User, trip.user_id)
        itin = current_itinerary(db, trip)
        if not user or not itin:
            return None
        s = get_settings()
        try:
            fresh = await get_tools().weather(trip.lat or 0, trip.lng or 0, trip.start_date.isoformat(), trip.end_date.isoformat())
        except Exception as exc:
            log.warning("watcher.weather_failed", trip=trip_id, error=str(exc))
            return None
        newly_wet = []
        for w in fresh:
            idx = (date.fromisoformat(w.date) - trip.start_date).days
            if not 0 <= idx < len(itin.days):
                continue
            was = itin.days[idx].weather
            outdoor = any(not i.indoor for i in itin.days[idx].items)
            if w.precip_prob >= s.rain_threshold_pct and (was is None or was.precip_prob < s.rain_threshold_pct) and outdoor:
                newly_wet.append((idx, w.date, w.precip_prob))
        if not newly_wet:
            return None
        key = "weather:" + trip.id + ":" + ",".join(d for _, d, _ in newly_wet)
        if db.scalar(select(ChangeEvent).where(ChangeEvent.trip_id == trip.id, ChangeEvent.idempotency_key == key)):
            return None  # idempotent: this exact change was already raised
        ev = ChangeEvent(trip_id=trip.id, type="weather", status="open", idempotency_key=key,
                         payload={"days": [{"day": i, "date": d, "rain_pct": p} for i, d, p in newly_wet]})
        db.add(ev)
        db.flush()
        reason = "Forecast now shows rain on " + ", ".join(f"day {i + 1} ({p}%)" for i, _, p in newly_wet)
        await propose_change(db, trip, user, ChangeRequest(changes=[Change(kind="weather", day=None)]),
                             change_type="replan", reason=reason, event=ev)
        return ev.id


async def check_all() -> int:
    with session_scope() as db:
        ids = [t for t in db.scalars(select(Trip.id).where(Trip.end_date >= date.today())).all()]
    raised = 0
    for tid in ids:
        if await check_trip(tid):
            raised += 1
    return raised


async def watch_loop() -> None:
    interval = max(get_settings().weather_watch_interval_min, 5) * 60
    while True:
        try:
            n = await check_all()
            log.info("watcher.cycle", proposals=n)
        except Exception as exc:
            log.warning("watcher.error", error=str(exc))
        await asyncio.sleep(interval)
