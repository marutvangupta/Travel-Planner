import pytest

from travel_planner.agent.tool_client import InProcessTools
from travel_planner.services import rag
from travel_planner.tools.common import ToolFailure


async def test_tools_return_normalised_models():
    t = InProcessTools()
    geo = await t.geocode("Tokyo")
    assert geo.currency == "JPY"
    places = await t.search_places("Tokyo", geo.lat, geo.lng, ["food"])
    assert places and all(p.source.id.startswith("demo:") for p in places)
    m = await t.route_matrix([(p.lat, p.lng) for p in places[:3]])
    assert m[0][0].minutes == 0 and m[0][1].minutes > 0
    w = await t.weather(geo.lat, geo.lng, "2026-11-10", "2026-11-12")
    assert len(w) == 3


async def test_unsupported_destination_is_a_structured_error():
    with pytest.raises(ToolFailure) as exc:
        await InProcessTools().geocode("Atlantis")
    assert exc.value.error_code == "destination_unsupported_in_demo"


async def test_tool_results_are_cached():
    from travel_planner.services.tracking import start_run

    t = start_run("test")
    tools = InProcessTools()
    await tools.geocode("Goa")
    await tools.geocode("Goa")
    assert t.cache_hits >= 1


def test_hybrid_retrieval_finds_relevant_chunk():
    hits = rag.search("Jaipur", "where can I buy block printed textiles and bargain", k=2)
    assert hits and hits[0].section == "Buy"
    hits = rag.search("Tokyo", "vegetarian ramen broth", k=2)
    assert any("vegan" in h.text.lower() or "vegetarian" in h.text.lower() for h in hits)


def test_retrieval_modes_return_ranked_results():
    for mode in ("vector", "keyword", "hybrid"):
        assert len(rag.search("Paris", "pickpockets and scams", k=3, mode=mode)) == 3
