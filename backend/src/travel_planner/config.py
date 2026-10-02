"""Application settings. Everything is optional so the app runs in demo mode with zero keys."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# USD per 1M tokens (input, output). Verify against current provider pricing and override
# with MODEL_PRICES_JSON='{"model": [in, out]}' when they change.
DEFAULT_MODEL_PRICES: dict[str, tuple[float, float]] = {
    "gpt-4.1": (2.00, 8.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "text-embedding-3-small": (0.02, 0.0),
}

USD_TO_INR = 84.0  # display only; the trip budget itself is always in INR


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    env: str = "dev"
    database_url: str = "sqlite:///./travel_planner.db"
    redis_url: str | None = None
    secret_key: str = "dev-only-secret-change-me-before-deploying-0123456789"
    access_token_minutes: int = 60 * 24 * 7
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"])

    # LLM
    openai_api_key: str | None = None
    openai_model_plan: str = "gpt-4.1"
    openai_model_fast: str = "gpt-4.1-mini"
    openai_model_agent: str | None = None  # the chat edit agent; defaults to the planning model
    agent_max_turns: int = 8
    openai_embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536
    model_prices_json: str | None = None

    # External data
    google_maps_api_key: str | None = None
    force_demo: bool = False  # ignore keys, use the bundled dataset (used by tests and evals)
    http_timeout_s: float = 6.0

    # Tools transport: call tool functions directly, or via the MCP server
    tools_mode: Literal["inprocess", "mcp"] = "inprocess"
    mcp_server_url: str = "http://localhost:8001/mcp"

    # Observability
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str = "https://cloud.langfuse.com"

    # Limits
    daily_run_quota: int = 60
    max_repair_loops: int = 2
    weather_watch_interval_min: int = 0  # 0 disables the background watcher
    rain_threshold_pct: int = 60

    def check_production(self) -> None:
        if self.env == "prod" and self.secret_key.startswith("dev-only-secret"):
            raise RuntimeError("SECRET_KEY must be set to a random value when ENV=prod")

    @property
    def llm_enabled(self) -> bool:
        return bool(self.openai_api_key) and not self.force_demo

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_maps_api_key) and not self.force_demo

    @property
    def langfuse_enabled(self) -> bool:
        return bool(self.langfuse_public_key and self.langfuse_secret_key) and not self.force_demo

    @property
    def model_prices(self) -> dict[str, tuple[float, float]]:
        prices = dict(DEFAULT_MODEL_PRICES)
        if self.model_prices_json:
            prices.update({k: (float(v[0]), float(v[1])) for k, v in json.loads(self.model_prices_json).items()})
        return prices


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings() -> None:
    get_settings.cache_clear()
