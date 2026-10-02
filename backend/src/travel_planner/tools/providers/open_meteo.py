"""Open-Meteo daily forecast and place search (free, no key). The forecast covers ~16 days ahead; beyond that callers fall back."""

from __future__ import annotations

from datetime import date, timedelta

from ...schemas import DayWeather, Source
from ..common import http_json, now_iso

URL = "https://api.open-meteo.com/v1/forecast"
GEOCODING = "https://geocoding-api.open-meteo.com/v1/search"
# GeoNames feature codes worth offering as a destination: towns and cities, regions, countries, islands
PLACE_CODES = ("PPL", "ADM", "PCL", "ISL", "RGN")

CODES = {
    0: "clear", 1: "clear", 2: "cloudy", 3: "cloudy", 45: "cloudy", 48: "cloudy",
    51: "rain", 53: "rain", 55: "rain", 56: "rain", 57: "rain", 61: "rain", 63: "rain", 65: "rain",
    66: "rain", 67: "rain", 71: "cloudy", 73: "cloudy", 75: "cloudy", 77: "cloudy",
    80: "rain", 81: "rain", 82: "rain", 85: "cloudy", 86: "cloudy", 95: "storm", 96: "storm", 99: "storm",
}


def in_forecast_window(start: date, end: date, today: date | None = None) -> bool:
    today = today or date.today()
    return start >= today and end <= today + timedelta(days=15)


async def forecast(lat: float, lng: float, start: date, end: date) -> list[DayWeather]:
    data = await http_json("GET", URL, params={
        "latitude": lat, "longitude": lng, "timezone": "auto",
        "start_date": start.isoformat(), "end_date": end.isoformat(),
        "daily": "precipitation_probability_max,temperature_2m_max,temperature_2m_min,weathercode",
    })
    daily = data["daily"]
    out: list[DayWeather] = []
    for i, day in enumerate(daily["time"]):
        prob = daily["precipitation_probability_max"][i]
        tmax = daily["temperature_2m_max"][i]
        condition = CODES.get(daily["weathercode"][i], "cloudy")
        if condition not in ("rain", "storm") and tmax is not None and tmax >= 38:
            condition = "hot"
        out.append(DayWeather(
            date=day, precip_prob=int(prob or 0), temp_min=float(daily["temperature_2m_min"][i]),
            temp_max=float(tmax), condition=condition,
            source=Source(id=f"meteo:{round(lat,2)},{round(lng,2)}:{day}", provider="open-meteo",
                          title="Open-Meteo forecast", url="https://open-meteo.com/", retrieved_at=now_iso()),
        ))
    return out


async def search_cities(query: str, limit: int) -> list[dict]:
    """City suggestions from Open-Meteo's GeoNames search, used when Google autocomplete is unavailable."""
    data = await http_json("GET", GEOCODING, params={"name": query, "count": min(limit * 2, 20), "language": "en", "format": "json"})
    out: list[dict] = []
    seen: set[str] = set()
    for r in data.get("results") or []:
        name = r.get("name") or ""
        if not name or not str(r.get("feature_code", "")).startswith(PLACE_CODES):
            continue
        detail = ", ".join(x for x in (r.get("admin1"), r.get("country")) if x and x != name)
        label = f"{name}, {detail}" if detail else name
        if label in seen:
            continue
        seen.add(label)
        out.append({"label": label, "name": name, "detail": detail})
        if len(out) >= limit:
            break
    return out
