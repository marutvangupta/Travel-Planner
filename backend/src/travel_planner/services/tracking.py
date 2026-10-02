"""Per-run metrics (tokens, cost, latency, tool calls). A ContextVar lets tools and the LLM gateway
record usage without threading a tracker through every call."""

from __future__ import annotations

import time
from contextvars import ContextVar
from dataclasses import dataclass, field

from ..config import USD_TO_INR, get_settings


@dataclass
class RunTracker:
    workflow: str = "create"
    started: float = field(default_factory=time.perf_counter)
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    llm_calls: int = 0
    models: set[str] = field(default_factory=set)
    tool_calls: int = 0
    tool_errors: int = 0
    cache_hits: int = 0
    repair_loops: int = 0
    node_timings: dict[str, float] = field(default_factory=dict)
    tool_timings: dict[str, list[float]] = field(default_factory=dict)
    planner: str = "heuristic"

    def add_llm(self, model: str, in_tok: int, out_tok: int) -> None:
        price_in, price_out = get_settings().model_prices.get(model, (0.0, 0.0))
        self.input_tokens += in_tok
        self.output_tokens += out_tok
        self.cost_usd += (in_tok * price_in + out_tok * price_out) / 1_000_000
        self.llm_calls += 1
        self.models.add(model)

    def add_tool(self, name: str, seconds: float, *, error: bool = False, cached: bool = False) -> None:
        self.tool_calls += 1
        if error:
            self.tool_errors += 1
        if cached:
            self.cache_hits += 1
        self.tool_timings.setdefault(name, []).append(seconds)

    def add_node(self, name: str, seconds: float) -> None:
        self.node_timings[name] = round(self.node_timings.get(name, 0.0) + seconds, 4)

    @property
    def latency_ms(self) -> int:
        return int((time.perf_counter() - self.started) * 1000)

    def summary(self) -> dict:
        return {
            "workflow": self.workflow,
            "planner": self.planner,
            "latency_ms": self.latency_ms,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_usd": round(self.cost_usd, 5),
            "cost_inr": round(self.cost_usd * USD_TO_INR, 2),
            "llm_calls": self.llm_calls,
            "models": sorted(self.models),
            "tool_calls": self.tool_calls,
            "tool_errors": self.tool_errors,
            "cache_hits": self.cache_hits,
            "repair_loops": self.repair_loops,
            "node_timings_ms": {k: int(v * 1000) for k, v in self.node_timings.items()},
        }


_current: ContextVar[RunTracker | None] = ContextVar("run_tracker", default=None)


def start_run(workflow: str) -> RunTracker:
    tracker = RunTracker(workflow=workflow)
    _current.set(tracker)
    return tracker


def current_tracker() -> RunTracker:
    tracker = _current.get()
    if tracker is None:  # tools called outside a run (tests, MCP server): count into a throwaway tracker
        tracker = RunTracker()
        _current.set(tracker)
    return tracker
