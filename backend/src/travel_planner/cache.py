"""Tiny cache: Redis when REDIS_URL is reachable, otherwise an in-process TTL dict."""

from __future__ import annotations

import json
import threading
import time
from typing import Any

import structlog

from .config import get_settings

log = structlog.get_logger()


class Cache:
    def __init__(self) -> None:
        self._mem: dict[str, tuple[float, str]] = {}
        self._lock = threading.Lock()
        self._redis = None
        url = get_settings().redis_url
        if url:
            try:
                import redis

                client = redis.Redis.from_url(url, socket_timeout=1.5, socket_connect_timeout=1.5)
                client.ping()
                self._redis = client
                log.info("cache.redis_connected")
            except Exception as exc:  # fall back silently: the cache is an optimisation, never a dependency
                log.warning("cache.redis_unavailable", error=str(exc))

    @property
    def backend(self) -> str:
        return "redis" if self._redis else "memory"

    def get(self, key: str) -> Any | None:
        if self._redis:
            try:
                raw = self._redis.get(key)
                return json.loads(raw) if raw else None
            except Exception:
                return None
        with self._lock:
            hit = self._mem.get(key)
            if not hit:
                return None
            expires, raw = hit
            if expires < time.time():
                self._mem.pop(key, None)
                return None
            return json.loads(raw)

    def set(self, key: str, value: Any, ttl: int) -> None:
        raw = json.dumps(value, default=str)
        if self._redis:
            try:
                self._redis.setex(key, ttl, raw)
            except Exception:
                pass
            return
        with self._lock:
            self._mem[key] = (time.time() + ttl, raw)

    def incr(self, key: str, ttl: int) -> int:
        if self._redis:
            try:
                n = int(self._redis.incr(key))
                if n == 1:
                    self._redis.expire(key, ttl)
                return n
            except Exception:
                return 0
        with self._lock:
            now = time.time()
            expires, raw = self._mem.get(key, (now + ttl, "0"))
            if expires < now:
                expires, raw = now + ttl, "0"
            n = int(raw) + 1
            self._mem[key] = (expires, str(n))
            return n

    def clear(self) -> None:
        with self._lock:
            self._mem.clear()


_cache: Cache | None = None


def get_cache() -> Cache:
    global _cache
    if _cache is None:
        _cache = Cache()
    return _cache


def reset_cache() -> None:
    global _cache
    _cache = None
