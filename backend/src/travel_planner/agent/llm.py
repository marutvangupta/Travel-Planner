"""OpenAI gateway: structured outputs only, usage tracked per run, one retry with the validation error appended.

Every caller must handle LLMError and fall back to the deterministic path, so the product degrades gracefully
instead of failing when the provider is down, rate-limited or returns something unusable.
"""

from __future__ import annotations

import time
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from ..config import get_settings
from ..services.tracking import current_tracker

T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    pass


class LLM:
    def __init__(self) -> None:
        self._client = None

    @property
    def enabled(self) -> bool:
        return get_settings().llm_enabled

    def _get_client(self):  # noqa: ANN202
        if self._client is None:
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(api_key=get_settings().openai_api_key, timeout=60.0, max_retries=2)
        return self._client

    async def parse(self, *, model: str, system: str, user: str, schema: type[T], max_tokens: int = 6000,
                    label: str = "llm") -> T:
        if not self.enabled:
            raise LLMError("LLM disabled")
        tracker = current_tracker()
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        last_err: Exception | None = None
        for _attempt in (1, 2):
            started = time.perf_counter()
            try:
                resp = await self._get_client().chat.completions.parse(
                    model=model, messages=messages, response_format=schema, max_completion_tokens=max_tokens,
                )
            except Exception as exc:  # network, auth, rate limit, bad request
                tracker.add_tool(f"llm:{label}", time.perf_counter() - started, error=True)
                last_err = exc
                break
            usage = getattr(resp, "usage", None)
            if usage:
                tracker.add_llm(model, usage.prompt_tokens, usage.completion_tokens)
            tracker.add_tool(f"llm:{label}", time.perf_counter() - started)
            msg = resp.choices[0].message
            if getattr(msg, "refusal", None):
                last_err = LLMError(f"model refused: {msg.refusal}")
                break
            if msg.parsed is not None:
                return msg.parsed
            last_err = LLMError("model returned no parsable output")
            messages = [*messages, {"role": "user", "content": "Your last reply was not valid for the required schema. Reply again with valid JSON only."}]
        raise LLMError(f"{label} failed: {last_err}") from (last_err if isinstance(last_err, Exception) else None)


    async def run_tools(self, *, model: str, messages: list[dict], tools: list[dict], max_tokens: int = 1200,
                        label: str = "agent") -> Any:
        """One tool-calling turn. The model must call a tool (strict schemas, one call at a time); returns the
        assistant message. Raises LLMError on any provider failure so the caller can fall back to the rules."""
        if not self.enabled:
            raise LLMError("LLM disabled")
        tracker = current_tracker()
        started = time.perf_counter()
        try:
            resp = await self._get_client().chat.completions.create(
                model=model, messages=messages, tools=tools, tool_choice="required", parallel_tool_calls=False,
                max_completion_tokens=max_tokens,
            )
        except Exception as exc:  # network, auth, rate limit, bad request
            tracker.add_tool(f"llm:{label}", time.perf_counter() - started, error=True)
            raise LLMError(f"{label} failed: {exc}") from exc
        usage = getattr(resp, "usage", None)
        if usage:
            tracker.add_llm(model, usage.prompt_tokens, usage.completion_tokens)
        tracker.add_tool(f"llm:{label}", time.perf_counter() - started)
        msg = resp.choices[0].message
        if getattr(msg, "refusal", None):
            raise LLMError(f"model refused: {msg.refusal}")
        return msg


_llm = LLM()


def get_llm() -> LLM:
    return _llm


__all__ = ["LLM", "LLMError", "ValidationError", "get_llm"]
