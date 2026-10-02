import json

import pytest
from fastapi.testclient import TestClient

from travel_planner.api.main import create_app

BODY = {"destination": "Jaipur", "start_date": "2026-11-10", "end_date": "2026-11-13", "budget_inr": 40000, "travelers": 2,
        "interests": ["history", "food"], "pace": "balanced", "constraints_text": "vegetarian"}


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture(scope="module")
def auth(client):
    r = client.post("/api/auth/register", json={"email": "t@example.com", "password": "pw-pw-pw-pw", "name": "T"})
    assert r.status_code == 200
    return {"authorization": f"Bearer {r.json()['token']}"}


def create_trip(client, auth, **over):
    events = []
    with client.stream("POST", "/api/trips/stream", json={**BODY, **over}, headers=auth) as r:
        assert r.status_code == 200
        for line in r.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


def test_requires_auth(client):
    assert client.get("/api/trips").status_code == 401
    assert client.post("/api/auth/login", json={"email": "t@example.com", "password": "wrong-password"}).status_code == 401


def test_stream_emits_stages_then_itinerary(client, auth):
    events = create_trip(client, auth)
    stages = [e["node"] for e in events if e["type"] == "stage" and e["status"] == "done"]
    assert stages[:3] == ["intake", "research", "plan"] and stages[-1] == "ground"
    final = events[-1]
    assert final["type"] == "itinerary" and final["metrics"]["tool_calls"] > 0
    assert len(final["itinerary"]["days"]) == 4


def test_unsupported_destination_streams_an_error(client, auth):
    events = create_trip(client, auth, destination="Atlantis")
    assert events[-1]["type"] == "error" and events[-1]["code"] == "destination_unsupported_in_demo"


def test_chat_proposal_apply_and_versions(client, auth):
    trip_id = next(e for e in create_trip(client, auth) if e["type"] == "itinerary")["trip_id"]
    r = client.post(f"/api/trips/{trip_id}/chat", json={"message": "make it more relaxed"}, headers=auth).json()
    assert r["intent"] == "edit" and r["proposal"]["version_id"]
    vid = r["proposal"]["version_id"]
    detail = client.get(f"/api/trips/{trip_id}", headers=auth).json()
    assert detail["version"]["version_no"] == 1 and len(detail["proposals"]) == 1
    assert client.post(f"/api/trips/{trip_id}/versions/{vid}/apply", headers=auth).status_code == 200
    detail = client.get(f"/api/trips/{trip_id}", headers=auth).json()
    assert detail["version"]["version_no"] == 2 and detail["trip"]["request"]["pace"] == "relaxed"
    assert all(len(d["items"]) <= 4 for d in detail["itinerary"]["days"])
    assert len(client.get(f"/api/trips/{trip_id}/versions", headers=auth).json()) == 2


def test_whatif_does_not_change_current_version(client, auth):
    trip_id = next(e for e in create_trip(client, auth) if e["type"] == "itinerary")["trip_id"]
    r = client.post(f"/api/trips/{trip_id}/whatif", json={"scenario": "What if I cut the budget by 10k?"}, headers=auth).json()
    assert r["intent"] == "whatif" and r["proposal"]["diff"]["cost_delta"] < 0
    assert client.get(f"/api/trips/{trip_id}", headers=auth).json()["version"]["version_no"] == 1


def test_simulated_rain_and_closure(client, auth):
    itin_ev = next(e for e in create_trip(client, auth) if e["type"] == "itinerary")
    trip_id, itin = itin_ev["trip_id"], itin_ev["itinerary"]
    day = next(d["index"] for d in itin["days"] if any(not i["indoor"] for i in d["items"]))
    r = client.post(f"/api/trips/{trip_id}/events/simulate", json={"type": "weather", "day": day}, headers=auth).json()
    assert r["proposal"] and r["proposal"]["affected"]
    stop = itin["days"][0]["items"][0]
    r = client.post(f"/api/trips/{trip_id}/events/simulate", json={"type": "closure", "item_id": stop["id"]}, headers=auth).json()
    names = [i["name"] for d in r["proposal"]["itinerary"]["days"] for i in d["items"]]
    assert stop["name"] not in names


def test_questions_are_answered_without_changing_anything(client, auth):
    trip_id = next(e for e in create_trip(client, auth) if e["type"] == "itinerary")["trip_id"]
    r = client.post(f"/api/trips/{trip_id}/chat", json={"message": "how much will this cost?"}, headers=auth).json()
    assert r["intent"] == "question" and "₹" in r["reply"] and r["proposal"] is None


def test_feedback_builds_memory_and_can_be_deleted(client, auth):
    ev = next(e for e in create_trip(client, auth) if e["type"] == "itinerary")
    item = next(i for d in ev["itinerary"]["days"] for i in d["items"] if i["category"] not in ("restaurant", "cafe"))
    for _ in range(2):
        out = client.post(f"/api/trips/{ev['trip_id']}/feedback", json={"item_id": item["id"], "signal": "down"}, headers=auth).json()
    assert out["new_memories"]
    mems = client.get("/api/memories", headers=auth).json()
    assert mems and mems[0]["evidence"]
    assert client.delete(f"/api/memories/{mems[0]['id']}", headers=auth).status_code == 204


def test_users_cannot_read_each_others_trips(client, auth):
    trip_id = next(e for e in create_trip(client, auth) if e["type"] == "itinerary")["trip_id"]
    other = client.post("/api/auth/register", json={"email": "o@example.com", "password": "pw-pw-pw-pw"}).json()["token"]
    assert client.get(f"/api/trips/{trip_id}", headers={"authorization": f"Bearer {other}"}).status_code == 404


def test_destination_suggestions_in_demo_mode(client, auth):
    assert client.get("/api/destinations").status_code == 401
    everything = client.get("/api/destinations", headers=auth).json()
    assert everything["mode"] == "demo"
    assert [s["label"] for s in everything["suggestions"]] == ["Jaipur, India", "Goa, India", "Tokyo, Japan", "Paris, France"]
    alias = client.get("/api/destinations", params={"q": "pink"}, headers=auth).json()["suggestions"]
    assert alias == [{"label": "Jaipur, India", "name": "Jaipur", "detail": "India"}]
    assert client.get("/api/destinations", params={"q": "berlin"}, headers=auth).json()["suggestions"] == []
    ranked = client.get("/api/destinations", params={"q": "pa"}, headers=auth).json()["suggestions"]
    assert [s["label"] for s in ranked] == ["Paris, France", "Goa, India", "Tokyo, Japan"]  # Goa via its alias Panaji
