"""CI gate: the smoke eval must stay above these floors. Raise the floors as quality improves; never lower them silently."""
import asyncio

import pytest

from evals.run_evals import run


@pytest.fixture(scope="module")
def report():
    return asyncio.run(run("smoke", judge=False))


def test_create_quality_floor(report):
    c = report["create"]
    assert c["hard_violation_rate"] == 0
    assert c["within_budget"] == 1.0
    assert c["citation_coverage_mean"] == 1.0
    assert c["tool_success_rate"] == 1.0


def test_change_floor(report):
    ch = report["changes"]
    assert ch["router_accuracy"] >= 0.95
    assert ch["hard_violation_rate"] == 0
    assert ch["closure_target_removed"] == 1.0
    assert ch["budget_target_met"] == 1.0
    assert ch["affected_recall"] >= 0.95 and ch["stability_mean"] >= 0.8


def test_retrieval_floor(report):
    assert report["retrieval"]["modes"]["hybrid"]["recall@3"] >= 0.9


def test_crud_floor(report):
    cr = report["crud"]
    assert cr["cases"] >= 8
    assert cr["router_accuracy"] >= 0.95
    assert cr["done_rate"] >= 0.95
    assert cr["hard_violation_rate"] == 0
    assert cr["stability_mean"] >= 0.85
