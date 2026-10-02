"""Shared helpers for tools: structured errors, caching, tracking, geometry."""

from __future__ import annotations

import hashlib
import json
import math
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from ..cache import get_cache
from ..config import get_settings
from ..services.tracking import current_tracker


class ToolFailure(Exception):
    def __init__(self, error_code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.retryable = retryable

    def as_dict(self) -> dict:
        return {"error_code": self.error_code, "message": self.message, "retryable": self.retryable}


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.TimeoutException | httpx.TransportError):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (429, 500, 502, 503, 504)
    return False


@retry(
    retry=retry_if_exception(_retryable),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=0.4, max=3),
    reraise=True,
)
async def http_json(method: str, url: str, **kwargs: Any) -> Any:
    timeout = kwargs.pop("timeout", get_settings().http_timeout_s)
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.request(method, url, **kwargs)
        resp.raise_for_status()
        return resp.json()


async def run_tool(
    name: str,
    args: dict,
    ttl: int,
    fn: Callable[[], Awaitable[Any]],
) -> Any:
    """Cache + timing + error accounting wrapper. `fn` must return JSON-serialisable data."""
    tracker = current_tracker()
    key = f"tool:{name}:{hashlib.sha1(json.dumps(args, sort_keys=True, default=str).encode()).hexdigest()}"
    started = time.perf_counter()
    if ttl > 0:
        hit = get_cache().get(key)
        if hit is not None:
            tracker.add_tool(name, time.perf_counter() - started, cached=True)
            return hit
    try:
        result = await fn()
    except ToolFailure:
        tracker.add_tool(name, time.perf_counter() - started, error=True)
        raise
    except Exception as exc:
        tracker.add_tool(name, time.perf_counter() - started, error=True)
        raise ToolFailure(
            "provider_error", f"{name} failed: {type(exc).__name__}: {exc}", retryable=_retryable(exc)
        ) from exc
    tracker.add_tool(name, time.perf_counter() - started)
    if ttl > 0:
        get_cache().set(key, result, ttl)
    return result
