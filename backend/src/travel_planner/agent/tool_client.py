"""The agent talks to tools through this interface. Two transports:
- inprocess: call tools/core.py directly (default; fastest, easiest to test)
- mcp: call the same tools through the MCP server over streamable HTTP (set TOOLS_MODE=mcp)
"""

from __future__ import annotations

import json
from typing import Any

from ..config import get_settings
from ..schemas import DayWeather, Geo, GuideChunk, Place, RouteCell
from ..services.tracking import current_tracker
from ..tools import core
from ..tools.common import ToolFailure


class ToolClient:
    async def _call(self, name: str, args: dict) -> dict:
        raise NotImplementedError

    async def geocode(self, destination: str) -> Geo:
        return core.geo_from(await self._call("geocode", {"destination": destination}))

    async def search_places(self, destination: str, lat: float, lng: float, interests: list[str],
                            max_results: int = 40) -> list[Place]:
        return core.places_from(await self._call("search_places", {
            "destination": destination, "lat": lat, "lng": lng, "interests": interests, "max_results": max_results,
        }))

    async def route_matrix(self, points: list[tuple[float, float]]) -> list[list[RouteCell]]:
        return core.matrix_from(await self._call("compute_route_matrix", {"points": [list(p) for p in points]}))

    async def weather(self, lat: float, lng: float, start: str, end: str) -> list[DayWeather]:
        return core.weather_from(await self._call("get_weather_forecast", {
            "lat": lat, "lng": lng, "start": start, "end": end,
        }))

    async def guides(self, destination: str, query: str, k: int = 4, mode: str = "hybrid") -> list[GuideChunk]:
        return core.guides_from(await self._call("search_travel_guides", {
            "destination": destination, "query": query, "k": k, "mode": mode,
        }))

    async def convert(self, amount: float, from_ccy: str, to_ccy: str = "INR") -> dict:
        return await self._call("convert_currency", {"amount": amount, "from_ccy": from_ccy, "to_ccy": to_ccy})


class InProcessTools(ToolClient):
    async def _call(self, name: str, args: dict) -> dict:
        if name == "geocode":
            return await core.geocode(args["destination"])
        if name == "search_places":
            return await core.search_places(**args)
        if name == "compute_route_matrix":
            return await core.compute_route_matrix([tuple(p) for p in args["points"]])
        if name == "get_weather_forecast":
            return await core.get_weather_forecast(args["lat"], args["lng"], args["start"], args["end"])
        if name == "search_travel_guides":
            return await core.search_travel_guides(args["destination"], args["query"], args["k"], args["mode"])
        if name == "convert_currency":
            return await core.convert_currency(args["amount"], args["from_ccy"], args["to_ccy"])
        raise ToolFailure("unknown_tool", name)


class McpTools(ToolClient):
    """Calls the standalone MCP server. A short-lived session per call keeps this simple and stateless."""

    def __init__(self, url: str) -> None:
        self.url = url

    async def _call(self, name: str, args: dict) -> dict:
        import time

        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        tracker = current_tracker()
        started = time.perf_counter()
        try:
            async with streamablehttp_client(self.url) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    res = await session.call_tool(name, args)
        except Exception as exc:
            tracker.add_tool(f"mcp:{name}", time.perf_counter() - started, error=True)
            raise ToolFailure("mcp_unavailable", f"MCP call {name} failed: {exc}", retryable=True) from exc
        payload = _unwrap(res)
        failed = "error" in payload and isinstance(payload["error"], dict)
        tracker.add_tool(f"mcp:{name}", time.perf_counter() - started, error=failed)
        if failed:
            err = payload["error"]
            raise ToolFailure(err.get("error_code", "tool_error"), err.get("message", ""), bool(err.get("retryable")))
        return payload


def _unwrap(res: Any) -> dict:
    structured = getattr(res, "structuredContent", None)
    if structured:
        return structured.get("result", structured) if set(structured) == {"result"} else structured
    for block in getattr(res, "content", []) or []:
        text = getattr(block, "text", None)
        if text:
            return json.loads(text)
    return {}


def get_tools() -> ToolClient:
    s = get_settings()
    return McpTools(s.mcp_server_url) if s.tools_mode == "mcp" else InProcessTools()
