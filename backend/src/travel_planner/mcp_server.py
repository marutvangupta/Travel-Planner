"""Standalone MCP server exposing the travel tools. Works with the agent (TOOLS_MODE=mcp) and with any MCP
client, e.g. Claude Desktop or an MCP inspector.

    python -m travel_planner.mcp_server            # streamable HTTP on :8001/mcp
    python -m travel_planner.mcp_server --stdio    # stdio transport for desktop clients
"""

from __future__ import annotations

import os
import sys

from mcp.server.fastmcp import FastMCP

from .db import init_db
from .services import rag
from .tools import core
from .tools.common import ToolFailure

mcp = FastMCP("travel-tools", host=os.getenv("MCP_HOST", "0.0.0.0"), port=int(os.getenv("MCP_PORT", "8001")))


async def _guard(coro) -> dict:  # noqa: ANN001
    try:
        return await coro
    except ToolFailure as exc:
        return {"error": exc.as_dict()}


@mcp.tool()
async def geocode(destination: str) -> dict:
    """Resolve a destination name to coordinates, country and currency."""
    return await _guard(core.geocode(destination))


@mcp.tool()
async def search_places(destination: str, lat: float, lng: float, interests: list[str] | None = None,
                        max_results: int = 40) -> dict:
    """Find places to visit near a point. Returns normalised places with opening hours, cost, duration and source."""
    return await _guard(core.search_places(destination, lat, lng, interests, max_results))


@mcp.tool()
async def get_place_details(place_ids: list[str]) -> dict:
    """Refresh details (hours, status) for known place ids."""
    return await _guard(core.get_place_details(place_ids))


@mcp.tool()
async def compute_route_matrix(points: list[list[float]]) -> dict:
    """Travel minutes/metres between every pair of [lat, lng] points. Short hops are walking, longer are by car."""
    return await _guard(core.compute_route_matrix([(p[0], p[1]) for p in points]))


@mcp.tool()
async def get_weather_forecast(lat: float, lng: float, start: str, end: str) -> dict:
    """Daily weather (rain probability, temperatures) for ISO dates start..end."""
    return await _guard(core.get_weather_forecast(lat, lng, start, end))


@mcp.tool()
async def convert_currency(amount: float, from_ccy: str, to_ccy: str = "INR") -> dict:
    """Convert an amount between currencies using reference exchange rates."""
    return await _guard(core.convert_currency(amount, from_ccy, to_ccy))


@mcp.tool()
async def search_travel_guides(destination: str, query: str, k: int = 4, mode: str = "hybrid") -> dict:
    """Retrieve travel-guide passages (tips, etiquette, getting around). mode: hybrid | vector | keyword."""
    return await _guard(core.search_travel_guides(destination, query, k, mode))


def main() -> None:
    init_db()
    rag.ensure_seeded()
    mcp.run(transport="stdio" if "--stdio" in sys.argv else "streamable-http")


if __name__ == "__main__":
    main()
