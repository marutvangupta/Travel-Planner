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


# ----------------------------------------------------------------------------- itinerary CRUD through chat


def _trip(client, auth):
    final = next(e for e in create_trip(client, auth) if e["type"] == "itinerary")
    return final["trip_id"], final["itinerary"]


def _chat(client, auth, trip_id, message):
    r = client.post(f"/api/trips/{trip_id}/chat", json={"message": message}, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def _detail(client, auth, trip_id):
    return client.get(f"/api/trips/{trip_id}", headers=auth).json()


def test_move_then_yes_applies_then_undo_restores(client, auth):
    trip_id, itin = _trip(client, auth)
    name = itin["days"][0]["items"][0]["name"]
    r = _chat(client, auth, trip_id, f"Move {name} to day 3")
    assert r["intent"] == "edit" and r["proposal"]["version_id"]
    assert any(c["kind"] == "moved" and c["name"] == name for c in r["proposal"]["diff"]["changes"])

    r = _chat(client, auth, trip_id, "yes")
    assert r["intent"] == "applied" and r["applied_version_id"]
    d = _detail(client, auth, trip_id)
    assert d["version"]["version_no"] == 2
    assert name in [i["name"] for i in d["itinerary"]["days"][2]["items"]]

    r = _chat(client, auth, trip_id, "undo")
    assert r["intent"] == "revert" and r["proposal"]["version_id"]
    assert _chat(client, auth, trip_id, "apply it")["intent"] == "applied"
    d = _detail(client, auth, trip_id)
    assert name in [i["name"] for i in d["itinerary"]["days"][0]["items"]]
    assert d["version"]["version_no"] == 3


def test_no_discards_the_waiting_proposal(client, auth):
    trip_id, _ = _trip(client, auth)
    _chat(client, auth, trip_id, "clear day 2")
    assert len(_detail(client, auth, trip_id)["proposals"]) == 1
    assert "Discarded" in _chat(client, auth, trip_id, "no")["reply"]
    assert _detail(client, auth, trip_id)["proposals"] == []


def test_custom_entry_survives_later_edits_and_settings_are_restored(client, auth):
    trip_id, _ = _trip(client, auth)
    r = _chat(client, auth, trip_id, "add a flight to Mumbai at 18:00 on day 4")
    assert r["proposal"]["version_id"]
    _chat(client, auth, trip_id, "yes")
    r = _chat(client, auth, trip_id, "make it more relaxed")
    _chat(client, auth, trip_id, "yes")
    d = _detail(client, auth, trip_id)
    flight = [i for i in d["itinerary"]["days"][3]["items"] if i["name"] == "Flight to Mumbai"]
    assert flight and flight[0]["custom"] and flight[0]["start"] == 18 * 60
    assert d["trip"]["request"]["pace"] == "relaxed"

    versions = client.get(f"/api/trips/{trip_id}/versions", headers=auth).json()
    v1 = next(v for v in versions if v["version_no"] == 1)
    r = client.post(f"/api/trips/{trip_id}/versions/{v1['id']}/restore", headers=auth).json()
    vid = r["proposal"]["version_id"]
    assert client.post(f"/api/trips/{trip_id}/versions/{vid}/apply", headers=auth).status_code == 200
    d = _detail(client, auth, trip_id)
    assert d["trip"]["request"]["pace"] == "balanced"  # settings come back with the stops
    assert not any(i["custom"] for day in d["itinerary"]["days"] for i in day["items"])


def test_clarifying_question_is_completed_by_the_next_message(client, auth):
    trip_id, itin = _trip(client, auth)
    r = _chat(client, auth, trip_id, "move it to day 2")
    assert r["intent"] == "clarify" and r["options"]
    target = next(o for o in r["options"] if o not in [i["name"] for i in itin["days"][1]["items"]])
    r = _chat(client, auth, trip_id, target)
    assert r["intent"] == "edit" and r["proposal"]["version_id"]
    assert any(c["name"] == target and c["kind"] == "moved" for c in r["proposal"]["diff"]["changes"])


def test_restore_rejects_unknown_versions(client, auth):
    trip_id, _ = _trip(client, auth)
    assert client.post(f"/api/trips/{trip_id}/versions/nope/restore", headers=auth).status_code == 404
