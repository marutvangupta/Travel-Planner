"""Run the eval suite and write a markdown + JSON report.

    python -m evals.run_evals --suite smoke            # 5 trips, fast (used in CI)
    python -m evals.run_evals --suite full             # 24 trips, 24 change cases, retrieval ablation
    python -m evals.run_evals --suite full --judge     # add LLM-as-judge scores (needs OPENAI_API_KEY)

By default evals run on the bundled demo dataset so results are reproducible and cost nothing. Pass --live to use the
configured providers instead (then latency, token and cost numbers reflect the real services).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any


def _bootstrap(live: bool) -> None:
    if not live:
        os.environ["FORCE_DEMO"] = "true"
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{Path(__file__).parent / 'eval.db'}")


async def run(suite: str, judge: bool) -> dict[str, Any]:
    from travel_planner.agent.graph import run_workflow
    from travel_planner.agent.router import parse_message
    from travel_planner.config import get_settings
    from travel_planner.db import init_db
    from travel_planner.schemas import Itinerary
    from travel_planner.services import rag
    from travel_planner.services.embeddings import embedder_id
    from travel_planner.services.validator import errors, validate

    from . import datasets as ds
    from .metrics import mean, pct, precision_recall, rate, recall_at_k, reciprocal_rank

    init_db()
    rag.ensure_seeded()
    settings = get_settings()
    trips = ds.smoke_cases() if suite == "smoke" else ds.trip_cases()
    report: dict[str, Any] = {
        "suite": suite, "planner": "llm" if settings.llm_enabled else "built-in (deterministic)",
        "data": "live" if settings.google_enabled else "bundled demo dataset", "embedder": embedder_id(),
        "python": platform.python_version(), "trips": len(trips),
    }

    # ------------------------------------------------------------------ 1. create: feasibility, grounding, latency
    created: dict[str, tuple[Any, Any, dict]] = {}
    rows = []
    node_ms: dict[str, list[float]] = defaultdict(list)
    tool_ms: dict[str, list[float]] = defaultdict(list)
    for name, req in trips:
        async for ev in run_workflow({"mode": "create", "request": req, "weights": {}, "memories": []}, "create"):
            if ev["type"] != "result":
                continue
            st, m = ev["state"], ev["metrics"]
            itin: Itinerary = st["draft"]
            ctx = st["ctx"]
            created[name] = (req, itin, {"ctx": ctx, "state": st})
            final_errs = errors(validate(itin, ctx))
            days = max(len(itin.days), 1)
            rows.append({
                "case": name, "hard_violations": len(final_errs), "valid_first_try": bool(st["stats"]["valid_first_try"]),
                "warnings": st["stats"]["warnings"], "within_budget": itin.totals.cost_inr <= req.budget_inr,
                "budget_used": itin.totals.cost_inr / req.budget_inr, "citation_coverage": st["stats"]["citation_coverage"],
                "stops_per_day": itin.totals.items / days, "light_days": sum(1 for d in itin.days if len(d.items) < 3),
                "latency_ms": m["latency_ms"], "tokens": m["input_tokens"] + m["output_tokens"], "cost_usd": m["cost_usd"],
                "tool_calls": m["tool_calls"], "tool_errors": m["tool_errors"], "cache_hits": m["cache_hits"],
                "repair_loops": m["repair_loops"],
            })
            for k, v in m["node_timings_ms"].items():
                node_ms[k].append(v)
    report["create"] = {
        "cases": len(rows),
        "hard_violation_rate": rate([r["hard_violations"] > 0 for r in rows]),
        "valid_first_try": rate([r["valid_first_try"] for r in rows]),
        "within_budget": rate([r["within_budget"] for r in rows]),
        "budget_used_mean": mean([r["budget_used"] for r in rows]),
        "citation_coverage_mean": mean([r["citation_coverage"] for r in rows]),
        "stops_per_day_mean": mean([r["stops_per_day"] for r in rows]),
        "light_day_cases": sum(1 for r in rows if r["light_days"]),
        "warnings_mean": mean([r["warnings"] for r in rows]),
        "latency_ms_p50": pct([r["latency_ms"] for r in rows], 0.5), "latency_ms_p95": pct([r["latency_ms"] for r in rows], 0.95),
        "tokens_mean": mean([r["tokens"] for r in rows]), "cost_usd_mean": mean([r["cost_usd"] for r in rows]),
        "tool_calls_mean": mean([r["tool_calls"] for r in rows]),
        "tool_success_rate": 1 - (sum(r["tool_errors"] for r in rows) / max(sum(r["tool_calls"] for r in rows), 1)),
        "cache_hit_rate": sum(r["cache_hits"] for r in rows) / max(sum(r["tool_calls"] for r in rows), 1),
        "repair_loops_mean": mean([r["repair_loops"] for r in rows]),
        "node_ms_p50": {k: pct(v, 0.5) for k, v in node_ms.items()},
        "worst_cases": sorted(rows, key=lambda r: (-r["hard_violations"], -r["light_days"]))[:3],
    }
    del tool_ms

    # ------------------------------------------------------------------ 2. change requests: router, impact, stability
    from travel_planner.schemas import Change  # noqa: F401  (documented in dataset)

    def make_message(kind: str, itin: Itinerary) -> tuple[str, dict]:
        """Natural-language message + expectations derived from the base plan."""
        d1 = itin.days[min(1, len(itin.days) - 1)]
        if kind == "rain":
            return f"it's going to rain on day {d1.index + 1}", {"intent": "edit", "kind": "weather", "day": d1.index}
        if kind == "closure":
            it = d1.items[0]
            return f"{it.name} is closed", {"intent": "edit", "kind": "closure", "item": it}
        if kind == "budget_cut":
            amt = max(int(itin.totals.cost_inr * 0.2), 1000)
            amt = round(amt / 1000) * 1000 or 1000
            return f"What if I reduce my budget by ₹{amt:,}?", {"intent": "whatif", "kind": "budget_delta", "amount": amt}
        if kind == "avoid":
            cats = [i.category for _, i in itin.all_items() if i.category not in ("restaurant", "cafe")]
            cat = next((c for c in ("museum", "market", "fort", "temple", "park", "beach") if c in cats), None)
            return (f"skip {cat}s please", {"intent": "edit", "kind": "avoid", "cat": cat}) if cat else ("make it more relaxed", {"intent": "edit", "kind": "pace"})
        if kind == "pace":
            return "make it more relaxed", {"intent": "edit", "kind": "pace"}
        return "no early mornings please", {"intent": "edit", "kind": "day_start"}

    change_rows = []
    kinds = ds.CHANGE_KINDS if suite == "full" else ["rain", "closure", "budget_cut", "avoid"]
    for name, (req, base, _ctxs) in list(created.items()):
        if suite == "full" and not name.endswith(("/classic", "/vegan-adventure", "/night-owls", "/shoppers")):
            continue  # 4 profiles x 4 destinations x 6 kinds is more than needed; sample across profiles
        for kind in kinds:
            if kind not in ("rain", "closure", "budget_cut", "avoid", "pace", "late_start"):
                continue
            msg, exp = make_message(kind, base)
            routed = parse_message(msg, base, req.budget_inr, req.pace)
            changes = routed.request.changes
            router_ok = routed.intent == exp["intent"] and bool(changes) and changes[0].kind == exp["kind"]
            row = {"case": f"{name}:{kind}", "router_ok": router_ok, "latency_ms": 0}
            if not router_ok:
                change_rows.append(row)
                continue
            async for ev in run_workflow({"mode": "change", "request": req, "base": base, "change": routed.request,
                                          "weights": {}}, "edit"):
                if ev["type"] != "result":
                    continue
                st, m = ev["state"], ev["metrics"]
                new, diff, ctx = st["draft"], st["diff"], st["ctx"]
                affected = {a.item_id for a in st.get("affected", [])}
                # after repair, a rain conflict with no feasible indoor alternative is kept on purpose and downgraded to a
                # warning; it is reported separately from true hard violations
                final_errs = errors(st["violations"])
                unresolved_rain = sum(1 for v in st["violations"] if v.code == "outdoor_in_rain")
                row.update({"hard_violations": len(final_errs), "unresolved_rain": unresolved_rain, "stability": diff.stability,
                            "latency_ms": m["latency_ms"],
                            "changed": bool(diff.changes), "tokens": m["input_tokens"] + m["output_tokens"], "cost_usd": m["cost_usd"]})
                if kind == "rain":
                    d = base.days[exp["day"]]
                    expected = {i.id for i in d.items if not i.indoor and not i.locked}
                    row["precision"], row["recall"] = precision_recall(affected & {i.id for _, i in base.all_items()}, expected)
                    wet_after = [i for d2 in new.days if d2.index == exp["day"] for i in d2.items if not i.indoor]
                    row["no_outdoor_in_rain"] = not wet_after
                    row["rain_resolved_share"] = 1 - (len(wet_after) / len(expected)) if expected else 1.0
                elif kind == "closure":
                    gone = all(i.place_id != exp["item"].place_id for _, i in new.all_items())
                    row["precision"], row["recall"] = precision_recall(affected, {exp["item"].id})
                    row["target_removed"] = gone
                elif kind == "budget_cut":
                    target = req.budget_inr - exp["amount"]
                    row["target_met"] = new.totals.cost_inr <= target or base.totals.cost_inr <= target
                elif kind == "avoid":
                    row["avoid_respected"] = all(i.category != exp["cat"] for _, i in new.all_items())
                elif kind == "pace":
                    row["pace_respected"] = all(len(dd.items) <= 4 for dd in new.days)
                else:
                    row["late_start_respected"] = all(dd.items[0].start >= 630 for dd in new.days if dd.items)
            change_rows.append(row)

    def col(key: str, kinds_: tuple[str, ...] | None = None) -> list[float]:
        return [float(r[key]) for r in change_rows if key in r and (kinds_ is None or r["case"].split(":")[1] in kinds_)]

    report["changes"] = {
        "cases": len(change_rows),
        "router_accuracy": rate([r["router_ok"] for r in change_rows]),
        "hard_violation_rate": rate([r.get("hard_violations", 0) > 0 for r in change_rows if r["router_ok"]]),
        "affected_precision": mean(col("precision")), "affected_recall": mean(col("recall")),
        "stability_mean": mean(col("stability")), "stability_p10": pct(col("stability"), 0.1),
        "rain_no_outdoor_in_rain": rate([bool(r["no_outdoor_in_rain"]) for r in change_rows if "no_outdoor_in_rain" in r]),
        "rain_resolved_share": mean(col("rain_resolved_share")),
        "unresolved_rain_cases": sum(1 for r in change_rows if r.get("unresolved_rain")),
        "closure_target_removed": rate([bool(r["target_removed"]) for r in change_rows if "target_removed" in r]),
        "budget_target_met": rate([bool(r["target_met"]) for r in change_rows if "target_met" in r]),
        "avoid_respected": rate([bool(r["avoid_respected"]) for r in change_rows if "avoid_respected" in r]),
        "pace_respected": rate([bool(r["pace_respected"]) for r in change_rows if "pace_respected" in r]),
        "late_start_respected": rate([bool(r["late_start_respected"]) for r in change_rows if "late_start_respected" in r]),
        "latency_ms_p50": pct([r["latency_ms"] for r in change_rows if r["latency_ms"]], 0.5),
        "latency_ms_p95": pct([r["latency_ms"] for r in change_rows if r["latency_ms"]], 0.95),
        "failures": [r["case"] for r in change_rows if not r["router_ok"] or r.get("hard_violations", 0) or r.get("precision", 1) < 1 or r.get("recall", 1) < 1][:8],
    }

    # ------------------------------------------------------------------ 3. retrieval ablation
    ret: dict[str, dict[str, float]] = {}
    for mode in ("keyword", "vector", "hybrid"):
        r1, r3, mrr = [], [], []
        for dest, q, relevant in ds.RETRIEVAL:
            ranked = [c.chunk_id for c in rag.search(dest, q, k=5, mode=mode)]
            r1.append(recall_at_k(ranked, relevant, 1))
            r3.append(recall_at_k(ranked, relevant, 3))
            mrr.append(reciprocal_rank(ranked, relevant))
        ret[mode] = {"recall@1": mean(r1), "recall@3": mean(r3), "mrr": mean(mrr)}
    report["retrieval"] = {"queries": len(ds.RETRIEVAL), "modes": ret}

    # ------------------------------------------------------------------ 4. optional judge
    if judge and settings.llm_enabled:
        from .judge import judge_itinerary

        scores = []
        for _name, (req, itin, _) in list(created.items())[:10]:
            try:
                scores.append(await judge_itinerary(req, itin))
            except Exception:  # judging is best-effort
                continue
        if scores:
            report["judge"] = {k: mean([getattr(s, k) for s in scores]) for k in ("personalization", "coherence", "variety", "realism")}
            report["judge"]["n"] = len(scores)
    return report


def _fmt(v: float, kind: str = "pct") -> str:
    if kind == "pct":
        return f"{v * 100:.1f}%"
    if kind == "ms":
        return f"{v:.0f} ms"
    return f"{v:.2f}"


def render_markdown(r: dict[str, Any]) -> str:
    c, ch, rt = r["create"], r["changes"], r["retrieval"]
    lines = [
        "# Evaluation report", "",
        f"- Suite: **{r['suite']}** ({r['trips']} trips) · Planner: **{r['planner']}** · Data: **{r['data']}** · Embedder: `{r['embedder']}`",
        f"- Python {r['python']} · generated by `python -m evals.run_evals --suite {r['suite']}`", "",
        "## 1. Itinerary quality (create)", "",
        "| Metric | Value |", "|---|---|",
        f"| Plans with any hard violation after repair | {_fmt(c['hard_violation_rate'])} |",
        f"| Valid on the first draft (before repair) | {_fmt(c['valid_first_try'])} |",
        f"| Within budget | {_fmt(c['within_budget'])} (mean {_fmt(c['budget_used_mean'])} of budget used) |",
        f"| Stops with a valid source (citation coverage) | {_fmt(c['citation_coverage_mean'])} |",
        f"| Stops per day (mean) | {_fmt(c['stops_per_day_mean'], 'n')} |",
        f"| Plans containing a light day (<3 stops) | {c['light_day_cases']} of {c['cases']} |",
        f"| Warnings per plan (mean) | {_fmt(c['warnings_mean'], 'n')} |",
        f"| Repair loops (mean) | {_fmt(c['repair_loops_mean'], 'n')} |", "",
        "## 2. Re-planning (natural-language changes)", "",
        "| Metric | Value |", "|---|---|",
        f"| Cases | {ch['cases']} |",
        f"| Router accuracy (intent and change type) | {_fmt(ch['router_accuracy'])} |",
        f"| Re-plans with a hard violation (excluding kept-with-warning rain) | {_fmt(ch['hard_violation_rate'])} |",
        f"| Affected-stop precision / recall (rain, closure) | {_fmt(ch['affected_precision'])} / {_fmt(ch['affected_recall'])} |",
        f"| Stability: other stops left in place (mean / p10) | {_fmt(ch['stability_mean'])} / {_fmt(ch['stability_p10'])} |",
        f"| Rain: wet day left fully indoor | {_fmt(ch['rain_no_outdoor_in_rain'])} |",
        f"| Rain: affected outdoor stops replaced or moved (mean share) | {_fmt(ch['rain_resolved_share'])} |",
        f"| Re-plans that kept an outdoor stop on a wet day with a warning | {ch['unresolved_rain_cases']} of {ch['cases']} |",
        f"| Closed stop removed | {_fmt(ch['closure_target_removed'])} |",
        f"| Budget target met | {_fmt(ch['budget_target_met'])} |",
        f"| Avoid-category respected | {_fmt(ch['avoid_respected'])} |",
        f"| Pace respected | {_fmt(ch['pace_respected'])} |",
        f"| Late start respected | {_fmt(ch['late_start_respected'])} |", "",
    ]
    if ch["failures"]:
        lines += ["Cases that did not fully pass: " + ", ".join(f"`{f}`" for f in ch["failures"]), ""]
    lines += [
        "## 3. Retrieval (travel guides)", "", f"{rt['queries']} labelled queries, embedder `{r['embedder']}`.", "",
        "| Mode | Recall@1 | Recall@3 | MRR |", "|---|---|---|---|",
    ]
    for mode, m in rt["modes"].items():
        lines.append(f"| {mode} | {_fmt(m['recall@1'])} | {_fmt(m['recall@3'])} | {_fmt(m['mrr'], 'n')} |")
    lines += [
        "", "## 4. Tools, latency and cost", "", "| Metric | Value |", "|---|---|",
        f"| Tool success rate | {_fmt(c['tool_success_rate'])} |",
        f"| Tool calls per plan (mean) | {_fmt(c['tool_calls_mean'], 'n')} |",
        f"| Cache hit rate | {_fmt(c['cache_hit_rate'])} |",
        f"| Create latency p50 / p95 | {_fmt(c['latency_ms_p50'], 'ms')} / {_fmt(c['latency_ms_p95'], 'ms')} |",
        f"| Re-plan latency p50 / p95 | {_fmt(ch['latency_ms_p50'], 'ms')} / {_fmt(ch['latency_ms_p95'], 'ms')} |",
        f"| Tokens per plan (mean) | {c['tokens_mean']:.0f} |",
        f"| Cost per plan (mean) | ${c['cost_usd_mean']:.4f} |", "",
        "Per-node median time (ms): " + ", ".join(f"{k} {v:.0f}" for k, v in c["node_ms_p50"].items()), "",
    ]
    if "judge" in r:
        j = r["judge"]
        lines += ["## 5. LLM judge (1-5)", "", f"n={j['n']}: personalization {j['personalization']:.2f}, coherence {j['coherence']:.2f}, "
                  f"variety {j['variety']:.2f}, realism {j['realism']:.2f}", ""]
    lines += [
        "> The built-in planner is deterministic and needs no API keys. Latency here excludes network calls to LLMs and map "
        "providers; run with `--live` and an `OPENAI_API_KEY` to measure those.", "",
    ]
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", choices=["smoke", "full"], default="smoke")
    ap.add_argument("--live", action="store_true", help="use configured providers instead of the demo dataset")
    ap.add_argument("--judge", action="store_true")
    ap.add_argument("--out", default=str(Path(__file__).parent / "reports" / "latest.md"))
    args = ap.parse_args()
    _bootstrap(args.live)
    started = time.time()
    report = asyncio.run(run(args.suite, args.judge))
    report["duration_s"] = round(time.time() - started, 2)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_markdown(report))
    out.with_suffix(".json").write_text(json.dumps(report, indent=2, default=str))
    print(render_markdown(report))
    print(f"\nWrote {out} and {out.with_suffix('.json')} in {report['duration_s']}s", file=sys.stderr)


if __name__ == "__main__":
    main()
