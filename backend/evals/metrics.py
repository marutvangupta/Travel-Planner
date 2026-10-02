from __future__ import annotations

import statistics


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    return s[min(len(s) - 1, int(round(p * (len(s) - 1))))]


def mean(values: list[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def rate(flags: list[bool]) -> float:
    return sum(1 for f in flags if f) / len(flags) if flags else 0.0


def precision_recall(predicted: set[str], expected: set[str]) -> tuple[float, float]:
    if not predicted and not expected:
        return 1.0, 1.0
    tp = len(predicted & expected)
    return (tp / len(predicted) if predicted else 0.0), (tp / len(expected) if expected else 1.0)


def recall_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    return len(set(ranked[:k]) & relevant) / len(relevant) if relevant else 0.0


def reciprocal_rank(ranked: list[str], relevant: set[str]) -> float:
    for i, r in enumerate(ranked, start=1):
        if r in relevant:
            return 1.0 / i
    return 0.0
