"""Destination suggestions in live mode, with the Google call stubbed (the shapes follow Places Autocomplete (New))."""

from types import SimpleNamespace

import pytest

from travel_planner.tools import core
from travel_planner.tools.common import ToolFailure
from travel_planner.tools.providers import google

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


async def test_live_mode_uses_google_and_reports_failures(live, monkeypatch):
    async def ok(q, n):
        return [{"label": f"{q.title()}, Somewhere", "name": q.title(), "detail": "Somewhere"}]

    monkeypatch.setattr(google, "autocomplete_cities", ok)
    assert (await core.suggest_destinations("udaipur-test"))["suggestions"][0]["label"] == "Udaipur-Test, Somewhere"

    async def fails(q, n):
        raise RuntimeError("Places API (New) is not enabled")

    monkeypatch.setattr(google, "autocomplete_cities", fails)
    with pytest.raises(ToolFailure):
        await core.suggest_destinations("never-cached-query")
