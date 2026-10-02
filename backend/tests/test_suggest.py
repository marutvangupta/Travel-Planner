"""Destination suggestions in live mode, with the providers stubbed (shapes follow Places Autocomplete (New) and
Open-Meteo's geocoding search)."""

from types import SimpleNamespace

import httpx
import pytest

from travel_planner.tools import core
from travel_planner.tools.common import ToolFailure
from travel_planner.tools.providers import google, open_meteo

RESPONSE = {
    "suggestions": [
        {"placePrediction": {"placeId": "a", "text": {"text": "Kyoto, Japan"},
                             "structuredFormat": {"mainText": {"text": "Kyoto"}, "secondaryText": {"text": "Japan"}}}},
        {"queryPrediction": {"text": {"text": "kyoto hotels"}}},
        {"placePrediction": {"placeId": "b", "text": {"text": "Kyotanabe, Kyoto, Japan"},
                             "structuredFormat": {"mainText": {"text": "Kyotanabe"}, "secondaryText": {"text": "Kyoto, Japan"}}}},
    ]
}


async def test_google_city_autocomplete_is_normalised(monkeypatch):
    seen = {}

    async def fake_http_json(method, url, **kw):
        seen.update(method=method, url=url, body=kw["json"])
        return RESPONSE

    monkeypatch.setattr(google, "http_json", fake_http_json)
    out = await google.autocomplete_cities("kyo", 5)
    assert out == [
        {"label": "Kyoto, Japan", "name": "Kyoto", "detail": "Japan"},
        {"label": "Kyotanabe, Kyoto, Japan", "name": "Kyotanabe", "detail": "Kyoto, Japan"},
    ]
    assert seen["method"] == "POST" and seen["url"].endswith("places:autocomplete")
    assert seen["body"]["includedPrimaryTypes"] == ["(cities)"]
    assert await google.autocomplete_cities("kyo", 1) == out[:1]


@pytest.fixture
def live(monkeypatch):
    monkeypatch.setattr(core, "get_settings", lambda: SimpleNamespace(google_enabled=True))


async def test_live_mode_waits_for_two_characters(live, monkeypatch):
    async def boom(*_a, **_k):
        raise AssertionError("should not call Google for one character")

    monkeypatch.setattr(google, "autocomplete_cities", boom)
    assert await core.suggest_destinations(" k ") == {"suggestions": [], "mode": "live"}


async def test_live_mode_uses_google_first(live, monkeypatch):
    async def ok(q, n):
        return [{"label": f"{q.title()}, Somewhere", "name": q.title(), "detail": "Somewhere"}]

    async def unused(q, n):
        raise AssertionError("Open-Meteo is only a fallback")

    monkeypatch.setattr(google, "autocomplete_cities", ok)
    monkeypatch.setattr(open_meteo, "search_cities", unused)
    assert (await core.suggest_destinations("udaipur-test"))["suggestions"][0]["label"] == "Udaipur-Test, Somewhere"


async def test_live_mode_falls_back_when_google_refuses_or_finds_nothing(live, monkeypatch):
    async def refused(q, n):
        raise RuntimeError("Places API (New) is not enabled")

    async def nothing(q, n):
        return []

    async def meteo(q, n):
        return [{"label": "Mumbai, Maharashtra, India", "name": "Mumbai", "detail": "Maharashtra, India"}]

    monkeypatch.setattr(open_meteo, "search_cities", meteo)
    for i, google_fn in enumerate((refused, nothing)):
        monkeypatch.setattr(google, "autocomplete_cities", google_fn)
        out = await core.suggest_destinations(f"mumbai-fallback-{i}")
        assert out == {"suggestions": [{"label": "Mumbai, Maharashtra, India", "name": "Mumbai", "detail": "Maharashtra, India"}], "mode": "live"}

    async def down(q, n):
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(google, "autocomplete_cities", refused)
    monkeypatch.setattr(open_meteo, "search_cities", down)
    with pytest.raises(ToolFailure):
        await core.suggest_destinations("never-cached-query")


async def test_open_meteo_place_search_is_normalised(monkeypatch):
    seen = {}

    async def fake_http_json(method, url, **kw):
        seen.update(method=method, url=url, params=kw["params"])
        return {"results": [
            {"name": "Mumbai", "feature_code": "PPLA", "admin1": "Maharashtra", "country": "India"},
            {"name": "Mumbai Airport", "feature_code": "AIRP", "admin1": "Maharashtra", "country": "India"},
            {"name": "Mumbai", "feature_code": "PPL", "admin1": "Maharashtra", "country": "India"},
            {"name": "Singapore", "feature_code": "PPLC", "country": "Singapore"},
            {"name": "Bali", "feature_code": "ADM1", "country": "Indonesia"},
        ]}

    monkeypatch.setattr(open_meteo, "http_json", fake_http_json)
    out = await open_meteo.search_cities("mum", 6)
    assert out == [
        {"label": "Mumbai, Maharashtra, India", "name": "Mumbai", "detail": "Maharashtra, India"},
        {"label": "Singapore", "name": "Singapore", "detail": ""},
        {"label": "Bali, Indonesia", "name": "Bali", "detail": "Indonesia"},
    ]
    assert seen["method"] == "GET" and seen["url"].endswith("/v1/search") and seen["params"]["name"] == "mum"
    assert await open_meteo.search_cities("mum", 1) == out[:1]

    async def no_results(method, url, **kw):
        return {"generationtime_ms": 0.5}  # Open-Meteo omits "results" when nothing matches

    monkeypatch.setattr(open_meteo, "http_json", no_results)
    assert await open_meteo.search_cities("zzqx", 6) == []


def test_google_error_reason_uses_googles_message():
    req = httpx.Request("POST", google.PLACES_AUTOCOMPLETE)
    body = {"error": {"code": 403, "status": "PERMISSION_DENIED", "message": "Places API (New) has not been used in project 1"}}
    exc = httpx.HTTPStatusError("403", request=req, response=httpx.Response(403, json=body, request=req))
    assert google.error_reason(exc) == "403 PERMISSION_DENIED: Places API (New) has not been used in project 1"
    exc = httpx.HTTPStatusError("502", request=req, response=httpx.Response(502, text="<html>", request=req))
    assert google.error_reason(exc) == "HTTP 502"
    assert google.error_reason(RuntimeError("boom")) == "RuntimeError: boom"
