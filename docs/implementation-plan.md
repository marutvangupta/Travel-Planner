> **Note:** this is the original implementation plan written before the build. The README lists what was built and where it
> deliberately differs (single backend package, no LangGraph checkpointer, proposals instead of interrupts, SVG chart instead
> of Google Maps JS, and so on).

# AI Travel Planner — Implementation Plan

## Context

`marutvangupta/Travel-Planner` is an empty repo (cloned at `/home/user/travel-planner`). The goal is a portfolio-grade **GenAI travel agent** that builds personalized day-by-day itineraries using real data (Google Maps Platform, weather), lets the user edit them in natural language, **detects and re-plans only the affected parts** when conditions change, supports "What if?" scenarios, cites its sources, learns preferences over time, and ships with a real **evaluation + cost/latency story**. Solo developer, so the plan favours a small number of well-built pieces over breadth.

Decisions already made with the user: **Google Maps Platform** (Places API (New) + Routes API) for places/travel times, **OpenAI** as the LLM provider. Stack: React, FastAPI, LangGraph, PostgreSQL + pgvector, Redis, MCP, Docker, Langfuse.

Guiding principle for the whole system: **the LLM proposes, deterministic code verifies.** Opening hours, travel times, and budget math are computed in Python, never trusted from the model. This is what makes the itineraries feasible and what makes the project interesting in interviews.

---

## 1. Product scope

**User flow (MVP):** sign in → trip wizard (destination, dates, budget in ₹, interests, travel style/pace, constraints like diet/mobility/"no early mornings") → streamed generation ("Finding places… checking hours… optimizing routes…") → day-by-day itinerary with map, times, travel legs, costs, weather badges and citation chips → chat to edit ("swap the museum on Day 2 for something outdoors") → alerts when weather changes → "What if?" comparisons → feedback (👍/👎/remove) feeds memory.

**Explicitly out of scope (v1):** bookings/payments, flights & hotels search (treat accommodation as a user-provided base location + nightly budget line), multi-city trips, collaboration/sharing, mobile app, real-time availability/ticketing APIs. Availability changes are simulated via a "mark as closed/sold out" action and Places `businessStatus`.

---

## 2. System architecture

```
┌──────────────────────── React (Vite + TS) ─────────────────────────┐
│ Trip Wizard │ Itinerary Timeline + Google Map │ Chat │ What-if │ Memory │
└───────────────┬──────────────── REST + SSE (streaming) ────────────┘
                │
┌───────────────▼──────────────── FastAPI (apps/api) ────────────────┐
│ Auth (JWT) · Trips/Versions API · Chat API · What-if API · Prefs   │
│ Rate limiting (Redis) · Background job: weather watcher (APScheduler)│
│                                                                     │
│   ┌──────────────── LangGraph agent ────────────────────────────┐   │
│   │ Router → Intake → Research → Plan → Validate ⇄ Repair       │   │
│   │        → Ground/Cite → Persist                               │   │
│   │ Router → Impact Analysis → Partial Re-plan → Validate → Diff │   │
│   │ Router → What-if (dry-run fork) → Compare                    │   │
│   │ Memory read (intake) / Memory write (after feedback)         │   │
│   └────────┬──────────────────────────┬─────────────────────────┘   │
│            │ deterministic services   │ MCP client                  │
│   validator · cost estimator ·        │ (langchain-mcp-adapters)    │
│   day scheduler · diff engine         │                             │
└────────────┼──────────────────────────┼─────────────────────────────┘
             │                          │ streamable HTTP
   ┌─────────▼──────────┐    ┌──────────▼───────── MCP server (mcp-server) ─┐
   │ PostgreSQL         │    │ search_places · get_place_details             │
   │  + pgvector        │    │ compute_route_matrix · get_weather_forecast   │
   │  + LangGraph       │◄───┤ convert_currency · search_travel_guides (RAG) │
   │    checkpointer    │    │ Redis cache · retries · normalized outputs    │
   └────────────────────┘    └───┬───────────┬───────────┬──────────┬───────┘
   ┌────────────────────┐        │           │           │          │
   │ Redis: tool cache, │   Google Places  Google     Open-Meteo  Frankfurter
   │ rate limits, quota │   API (New)      Routes API  (weather)   (FX rates)
   └────────────────────┘
                 ┌──────────────────────────────────────────┐
  all LLM + tool │ Langfuse: traces, token/cost, latency,   │
  calls traced → │ datasets & eval scores, user feedback    │
                 └──────────────────────────────────────────┘
  LLM: OpenAI (flagship model → plan/re-plan; small model → router, extraction, judge)
  Embeddings: OpenAI text-embedding-3-small (1536-d) → pgvector
```

## 3. Components and responsibilities

| Component | Responsibility |
|---|---|
| **React web app** | Wizard, itinerary timeline, Google Map (`@vis.gl/react-google-maps`, required anyway by Google ToS when showing Places data on a map), chat with SSE streaming, diff/compare views, memory page. |
| **FastAPI API** | Auth, CRUD for trips/versions/preferences, starts graph runs, streams node progress over SSE, enforces quotas. |
| **LangGraph agent** | Orchestrates the workflows below; state persisted with `PostgresSaver` checkpointer (thread = trip). |
| **Deterministic services** | `validator` (hours, travel time, budget, pace, constraints), `cost_estimator` (Google `priceLevel` → ₹ ranges + entry fees from RAG), `scheduler` (orders a day's activities by nearest-neighbour using the route matrix and fits time windows), `diff_engine` (version diffs, stability score). |
| **MCP server** | Single `travel-tools` server exposing all external data as typed tools; owns caching, retries, provider normalization, source metadata. Also usable from Claude Desktop/Cursor — a demo point. |
| **RAG store** | Wikivoyage guide chunks (CC BY-SA, citable) in pgvector + Postgres full-text; hybrid search. |
| **Memory** | Structured preference profile + embedded "learned preference" memories with provenance. |
| **Eval harness** | Golden datasets, deterministic metrics, LLM-judge, results pushed to Langfuse + markdown report. |

## 4. Agent / workflow design (LangGraph)

**Graph state (Pydantic):** `trip_request`, `user_profile`, `memories[]`, `candidates[]` (normalized places), `route_matrix`, `weather[]`, `guide_chunks[]`, `sources{}` (id → url/provider/retrieved_at), `itinerary` (current), `draft`, `violations[]`, `change_request`, `affected_items[]`, `mode` (create | edit | replan | whatif | qa), `dry_run`, `run_metrics`.

**Itinerary schema (the contract everything hangs off):**
`Itinerary{days[Day{date, weather_summary, items[Item{id, place_id, name, category, indoor: bool, start, end, est_cost_inr, travel_from_prev{mode, minutes}, why, source_ids[], locked: bool}]}], totals{cost_inr, by_category}, assumptions[]}` — produced via OpenAI **Structured Outputs** (JSON schema, strict).

**Workflow A — Create itinerary**
1. **Intake** (small model): normalize free-text constraints into structured fields; load profile + top-k memories.
2. **Research** (code-driven, parallel — *not* an open-ended tool loop): geocode → `search_places` per interest category → `get_place_details` for top N → `compute_route_matrix` among shortlisted places + base → `get_weather_forecast` → `search_travel_guides`. Cheaper, faster and more predictable than letting the LLM decide tool calls.
3. **Plan** (flagship model): select and assign places to days/time slots from the *provided candidates only* (no invented places), give a `why` per item, attach `source_ids`.
4. **Validate** (pure Python): opening hours vs slot, travel time between consecutive items (route matrix), daily pace limits, total ≤ budget, dietary/mobility/disliked categories, duplicates, outdoor items on high-rain days. Scheduler recomputes exact times.
5. **Repair** (conditional edge): if violations, send the violation list back to the planner — max 2 loops, then return best draft with flagged warnings.
6. **Ground/Cite**: verify every `source_id` exists in `sources`; strip unsupported claims or mark "unverified".
7. **Persist** as `itinerary_versions` v1; emit metrics.

**Workflow B — Natural-language change (chat)**
Router (small model, structured output) classifies: `edit` | `constraint_change` (budget/prefs) | `whatif` | `question`. Edits are converted to a structured `ChangeRequest` → **Impact Analysis** → **Partial Re-plan** → Validate/Repair → Diff → user accepts/rejects (LangGraph `interrupt` for human-in-the-loop) → new version.

**Workflow C — Event-driven re-plan (the core differentiator)**
Triggers: weather watcher job (re-fetches forecast daily for upcoming trips; also a "simulate rain on Day 2" dev button), place marked closed/sold out, budget changed, preference changed.
**Impact Analysis is deterministic rules first:** rain prob > 60% or extreme heat → outdoor items that day; closed place → that item + successors whose travel legs depend on it; budget cut → items ranked by cost/value until within budget; new dislike → matching categories. Output: `affected_items[]` with reasons. **Partial Re-plan** gives the LLM only affected slots, with all other items `locked`, plus fresh candidates. Metric: **stability** = % of unaffected items preserved.

**Workflow D — What if?**
Same as C but on a forked state with `dry_run=True`, never persisted unless the user clicks "Apply". Returns a comparison: cost delta, items dropped/added/swapped, travel-time change, interest coverage change. E.g. "reduce budget by ₹15,000" → budget constraint change → impact → re-plan → compare.

**Q&A** ("is Day 3 too packed?") answers from current itinerary + RAG with citations, no mutation.

## 5. Database schema (PostgreSQL + pgvector, Alembic migrations)

| Table | Key columns |
|---|---|
| `users` | id, email, password_hash, created_at |
| `user_preferences` | user_id PK, pace, budget_tier, travel_style, diet, mobility, interests jsonb, category_weights jsonb, updated_at |
| `user_memories` | id, user_id, content text, embedding vector(1536), kind (explicit/inferred), confidence, source_trip_id, created_at, deleted_at |
| `trips` | id, user_id, destination, lat, lng, start_date, end_date, budget_inr, request jsonb, current_version_id, status |
| `itinerary_versions` | id, trip_id, version_no, parent_version_id, itinerary jsonb, change_reason, change_type (create/edit/replan/whatif), is_applied, metrics jsonb, created_at |
| `change_events` | id, trip_id, type (weather/availability/budget/pref/user_edit), payload jsonb, affected_item_ids jsonb, status, created_at |
| `feedback` | id, user_id, trip_id, item_id, place_id, category, signal (up/down/removed/kept), created_at |
| `guide_documents` / `guide_chunks` | doc: destination, title, url, license, fetched_at · chunk: doc_id, section, content, embedding vector(1536), tsv tsvector (HNSW + GIN indexes) |
| `agent_runs` | id, trip_id, user_id, workflow, langfuse_trace_id, model, input_tokens, output_tokens, cost_usd, latency_ms, tool_calls, tool_errors, repair_loops, status |
| `eval_runs` / `eval_results` | run: git_sha, dataset, config · result: case_id, metric, value, details jsonb |
| LangGraph checkpoint tables | created by `PostgresSaver.setup()` |

Itineraries are **JSONB snapshots per version** (simple, gives free history/diff/what-if forks). Google Places content is **not** stored long-term (ToS): keep `place_id` permanently, cache details in Redis with short TTL.

## 6. External APIs / tools

| Need | API | Notes |
|---|---|---|
| Places search, details, hours, price level, rating, photos | Google **Places API (New)**: Text Search, Nearby Search, Place Details | Use field masks to control cost; cache in Redis; show Google attribution. |
| Travel times/distances | Google **Routes API** `computeRouteMatrix` | Matrix over shortlisted places per day; modes walk/drive/transit. |
| Geocoding / autocomplete | Places Autocomplete (frontend) + Geocoding | Restrict browser key by HTTP referrer. |
| Map display | Maps JavaScript API | Required to display Places data on a map. |
| Weather | **Open-Meteo** forecast | Free, no key, 16-day forecast; hourly precipitation probability. |
| Currency | **Frankfurter** | Show costs in ₹ for international destinations. |
| Guide content (RAG) | **Wikivoyage** dumps/API | CC BY-SA → citable with attribution. |
| LLM | OpenAI | Flagship model for plan/re-plan; small model for router/intake/judge. Pin exact model IDs + prices in `config.py`. |
| Embeddings | OpenAI `text-embedding-3-small` | Cheap; 1536 dims. |

## 7. RAG and memory design

**RAG (guides):** Ingest Wikivoyage pages for 5 seed destinations (e.g. Jaipur, Goa, Tokyo, Paris, Bali). Chunk by section ("See", "Do", "Eat", "Get around", "Stay safe"), ~400 tokens, metadata = destination/section/url. **Hybrid retrieval**: pgvector cosine + Postgres full-text, merged with Reciprocal Rank Fusion, filtered by destination. Used for local tips, neighbourhood context, entry fees, safety, etiquette; **facts like hours/location always come from Places**, not RAG.

**Citations (app-implemented, since OpenAI has no native doc citations):** every tool result and chunk gets a `source_id` (`gplaces:<place_id>`, `wv:<chunk_id>`, `meteo:<date>`). Planner schema requires `source_ids` per item and tip; the Ground node rejects unknown IDs; the UI renders them as citation chips linking to Google Maps / Wikivoyage. Evaluated with citation precision/coverage.

**Memory:**
- *Short-term*: LangGraph state + Postgres checkpointer per trip thread (chat history, current draft).
- *Long-term structured*: `user_preferences` (explicit, editable in UI) + `category_weights` updated from feedback (simple exponential update — no ML).
- *Long-term episodic*: after a trip is finalized or feedback accumulates, the small model extracts "learned preferences" ("prefers street food over fine dining", "skips museums after 5pm") → `user_memories` with embedding, confidence, provenance. Retrieved top-k at intake. **Memory page lets users view/delete** (transparency, privacy).

## 8. MCP tool design

One server, `mcp-server/` (official Python `mcp` SDK, FastMCP, **streamable HTTP** transport in Docker). The agent connects via `langchain-mcp-adapters`.

| Tool | Input | Output (normalized, never raw Google JSON) |
|---|---|---|
| `search_places` | query, lat/lng, radius_m, category, max_results | `[Place{place_id, name, category, lat, lng, rating, price_level, source}]` |
| `get_place_details` | place_ids[] | `[PlaceDetails{opening_hours by weekday, business_status, price_level, typical_duration_min, indoor guess, source}]` |
| `compute_route_matrix` | origins[], destinations[], mode | `[[{minutes, meters}]]` + source |
| `get_weather_forecast` | lat, lng, start, end | `[DayWeather{date, precip_prob_max, temp_min/max, condition}]` |
| `convert_currency` | amount, from, to | amount, rate, as_of |
| `search_travel_guides` | destination, query, k | `[Chunk{chunk_id, section, text, url}]` |

Conventions: Pydantic input/output schemas; every result carries `source{id, provider, url, retrieved_at}`; errors returned as structured `{error_code, message, retryable}`; Redis caching with per-tool TTLs; `tenacity` retries with timeouts; per-tool call counters exposed to tracing. **Implement tools as plain Python functions first (`mcp-server/tools/*.py`), MCP is a thin wrapper** → unit-testable in-process, served over MCP in Docker.

## 9. Evaluation strategy

Datasets (YAML in `evals/datasets/`): **30 trip requests** (varied destinations, budgets, constraints), **20 change requests** with labeled expected affected items, **10 what-ifs**, **40 retrieval queries** with labeled relevant chunks. Tool responses recorded as fixtures (VCR-style) so evals are reproducible and don't burn Google quota; a separate "live" mode exists.

| Dimension | Metric | How |
|---|---|---|
| Itinerary feasibility | constraint-violation rate (hours, travel, budget, pace, diet/mobility), % plans valid first try vs after repair | Deterministic validator |
| Itinerary quality | personalization, coherence, variety, realism (1–5 rubric) | LLM-as-judge (small model), calibrated vs ~20 hand-labeled plans |
| Re-plan quality | affected-item precision/recall, **stability score**, constraint satisfaction after re-plan | Labeled change set |
| Retrieval | Recall@5, MRR, hybrid vs vector-only ablation | Labeled queries |
| Grounding | citation coverage (% items with valid source), citation precision (judge: source supports claim) | Ground node + judge |
| Tool reliability | success rate, retry rate, timeout rate, schema-valid rate per tool | `agent_runs` + traces |
| Latency | p50/p95 end-to-end and per node, time-to-first-day streamed | Langfuse |
| Cost | tokens and $/₹ per itinerary, per edit, per what-if | `agent_runs` |

`evals/run_evals.py` writes results to `eval_runs` and Langfuse datasets/scores and generates `evals/reports/latest.md`. CI runs a 5-case smoke subset on fixtures; the full suite runs manually before releases. **Put the headline numbers in the README.**

## 10. Observability and cost tracking

- **Langfuse Cloud free tier** for dev (self-hosting Langfuse v3 needs ClickHouse + MinIO — not worth it initially; optional compose profile later).
- LangGraph runs traced via the Langfuse LangChain `CallbackHandler`: `session_id = trip_id`, `user_id`, tags = workflow; each node and MCP tool call is a span.
- Token + cost per generation from Langfuse model pricing; also written to `agent_runs` so the app can show "This plan: 14.2k tokens, ₹3.10, 18 s".
- User 👍/👎 sent as Langfuse scores; eval scores attached to traces.
- Guards: max tool calls per run, max repair loops, `max_tokens` per call, per-user daily run quota in Redis.
- Structured JSON logs (`structlog`) with `trace_id` correlation.

## 11. Security and failure handling

**Security:** JWT auth (access + refresh) with argon2 password hashing; server-side API keys only in `.env` (`.env.example` committed); Google browser key restricted by referrer and API; CORS allowlist; Redis rate limiting; Pydantic validation of all inputs and all LLM outputs. **Prompt-injection hygiene:** tool/RAG text passed as delimited data, the LLM has no write/side-effect tools (it only returns a structured plan that code validates and persists); planner may only choose from provided `place_id`s. Users can delete memories/account.

**Failure handling:**
| Failure | Behaviour |
|---|---|
| Google API timeout/5xx | retry w/ backoff → serve stale cache → continue with fewer candidates, flag "limited data" |
| Weather unavailable | plan without weather, show banner, watcher retries later |
| Missing opening hours | mark item "hours unverified" rather than dropping |
| LLM schema failure | one retry with validation error appended → fail gracefully |
| Validator still failing after 2 repairs | return best draft with explicit warnings |
| Process crash mid-run | resume from LangGraph Postgres checkpoint |
| Duplicate re-plan triggers | idempotency key per `change_event` |

## 12. Frontend pages / features

1. **Auth** (login/register).
2. **New Trip wizard** — Places Autocomplete for destination, date range, ₹ budget, interest chips, pace/style, constraints text box.
3. **Trip workspace** — day tabs + timeline cards (time, travel leg, cost, weather badge, `why`, citation chips, 👍/👎/remove, lock), synced Google Map with per-day route, budget bar; streaming progress during generation.
4. **Chat panel** — natural-language edits; shows proposed **diff** (added/removed/moved) with Accept/Reject.
5. **Alerts** — "Rain on Day 2 affects 2 activities → Review re-plan".
6. **What-if panel** — presets (budget −₹15k, slower pace, +1 day, no taxis) + free text; side-by-side comparison with deltas; "Apply".
7. **Version history** — list of versions with change reasons; restore.
8. **My Trips** list.
9. **Preferences & Memory** — edit profile, view/delete learned memories with provenance.
10. *(Later)* **Metrics page** — latest eval report + cost/latency charts from `agent_runs`.

Stack: React + Vite + **TypeScript**, Tailwind + shadcn/ui, TanStack Query, `@microsoft/fetch-event-source` (or native `EventSource`) for SSE, React Router.

## 13. Recommended folder structure

```
travel-planner/
├── apps/
│   ├── web/                      # React + Vite + TS
│   │   └── src/{pages,components/itinerary,components/chat,components/map,api,hooks}
│   └── api/                      # FastAPI (uv, ruff, pytest)
│       ├── app/
│       │   ├── main.py
│       │   ├── core/             # config (model IDs, prices), security, logging
│       │   ├── api/routes/       # auth, trips, chat, whatif, preferences, events
│       │   ├── db/               # SQLAlchemy models, session; alembic/ alongside
│       │   ├── schemas/          # itinerary.py (the contract), trip, prefs, change
│       │   ├── agent/
│       │   │   ├── graph.py  state.py  llm.py  mcp_client.py
│       │   │   ├── nodes/        # router, intake, research, plan, validate, repair,
│       │   │   │                 # ground, impact, replan, whatif, memory
│       │   │   └── prompts/
│       │   ├── services/         # validator, scheduler, cost_estimator, diff_engine,
│       │   │                     # rag, memory
│       │   └── jobs/             # weather_watcher
│       └── tests/
├── mcp-server/
│   ├── server.py                 # FastMCP, streamable HTTP
│   ├── tools/                    # places, routes, weather, currency, guides
│   ├── providers/                # google, open_meteo, frankfurter clients
│   ├── cache.py
│   └── tests/fixtures/
├── evals/{datasets,metrics,judges,fixtures,reports}/  run_evals.py
├── data/ingest/                  # wikivoyage ingestion + chunking + embedding
├── docker-compose.yml            # postgres(pgvector), redis, api, mcp-server, web
├── .env.example
├── docs/{architecture.md, adr/, demo.gif}
├── .github/workflows/ci.yml      # lint, tests, eval smoke subset
└── README.md
```

## 14. Development phases (in order)

| # | Phase | Deliverable / exit criteria | Est. |
|---|---|---|---|
| 0 | **Foundations** | Monorepo, docker-compose (pgvector, Redis, api, web), FastAPI health, Alembic, React shell, CI lint/test | 2–3 d |
| 1 | **Tools layer + MCP** | Places, Routes, Open-Meteo, FX as typed functions w/ Redis cache + recorded fixtures; wrapped in MCP server; agent can list/call tools | ~1 wk |
| 2 | **Core planner (first demo)** | Itinerary schema; graph Intake→Research→Plan→Validate⇄Repair→Persist; validator/scheduler/cost estimator; `POST /trips` with SSE; wizard + timeline + map UI | ~1.5 wk |
| 3 | **Observability + eval baseline** | Langfuse tracing, `agent_runs` cost table, 20-case golden set, deterministic metrics, eval runner + report | 3–4 d |
| 4 | **RAG + citations** | Wikivoyage ingestion (5 destinations), hybrid search, Ground node, citation chips, retrieval eval (vector vs hybrid) | ~1 wk |
| 5 | **Chat edits + event re-planning** | Router, ChangeRequest, Impact Analysis, partial re-plan with locks, diff + accept/reject (interrupt), versions, weather watcher + "simulate" button, re-plan eval set | ~1.5 wk |
| 6 | **What-if** | Dry-run fork, comparison API + UI, presets | 3–4 d |
| 7 | **Memory & learning** | Preferences page, feedback signals → category weights, inferred memories with provenance, memory retrieval at intake | ~1 wk |
| 8 | **Hardening + showcase** | Auth polish, rate limits/quotas, fallbacks, LLM-judge evals, CI eval smoke, README with metrics, architecture diagram, demo GIF/video, deploy (single VM / Render + Neon + Upstash) | ~1 wk |

**Build first:** itinerary schema, tools with caching, the deterministic validator, the create workflow, tracing + eval baseline (measure before adding features).
**Build later:** RAG polish, memory learning, what-if UI, LLM-judge, metrics page, Langfuse self-host, deployment.
**Skip entirely in v1:** Celery/queues (APScheduler + FastAPI background tasks suffice), semantic LLM cache, multi-agent setups, fine-tuning, separate vector DB, Kubernetes.

## 15. Key technical decisions and trade-offs

| Decision | Choice | Trade-off |
|---|---|---|
| Research step | Code-driven parallel tool calls | Less "agentic" than a free tool loop, but 3–5× faster, cheaper, deterministic; LLM tool-calling kept for chat Q&A |
| Feasibility | Deterministic validator + bounded repair loop | Extra code, but measurable, explains failures, and is the core quality lever |
| Re-planning | Rule-based impact analysis + partial re-plan with locked items | Rules need maintenance; in return stable plans and a clear stability metric vs full regeneration |
| Itinerary storage | JSONB versions | Harder ad-hoc SQL over items; trivial history, diff, and what-if forks |
| MCP | One server; tools are plain functions underneath | Extra network hop; gains reusability, clean boundary, and an interview talking point |
| Vector store | pgvector in the main DB | Fine at this scale; no extra infra |
| Citations | App-level `source_id` contract | More work than native citation APIs, but provider-agnostic and verifiable |
| Places data | Live via API + short Redis TTL, only `place_id` persisted | Respects Google ToS; more API calls, mitigated by caching and field masks |
| Streaming | SSE | One-directional is enough; simpler than WebSockets |
| Observability | Langfuse Cloud first | External dependency; avoids running ClickHouse/MinIO solo |
| Models | Flagship for plan/re-plan, small for router/intake/judge | Two models to pin/price; large cost savings on high-volume steps |

---

## Final summary

### 1. MVP scope
Create-trip wizard → streamed, validated day-by-day itinerary built from Google Places + Routes + Open-Meteo (opening hours, travel time, budget and pace enforced by a deterministic validator with a repair loop) → map + timeline UI with costs in ₹ and citation chips (Google Places + Wikivoyage) → chat edits with diff/accept → weather-triggered **partial** re-plan → "What if budget −₹X?" comparison → explicit preferences + feedback-based memory → Langfuse tracing, cost per plan, and an eval report on 20–30 golden cases. 5 seed destinations, single city per trip, no bookings.

### 2. Phase-by-phase implementation plan
See §14: Foundations → Tools + MCP → Core planner (first demo) → Observability + eval baseline → RAG + citations → Chat edits + event re-planning → What-if → Memory → Hardening + showcase (~8–9 weeks part-time-heavy solo).

### 3. Final architecture diagram
See §2.

### 4. Recommended README structure
1. Title, one-line pitch, demo GIF, live link
2. **Headline metrics table** (constraint-violation rate, stability score, Recall@5, citation precision, p95 latency, cost per itinerary)
3. Features (with screenshots: itinerary, re-plan diff, what-if compare)
4. Architecture diagram + LangGraph graph diagram (exported Mermaid)
5. How it works: create flow, re-plan flow, what-if flow
6. Design decisions & trade-offs (link `docs/adr/`)
7. Evaluation methodology + how to run evals
8. Observability (Langfuse trace screenshot, cost tracking)
9. MCP server: tools list + how to use it from Claude Desktop/Cursor
10. Tech stack
11. Quickstart (`cp .env.example .env`, `docker compose up`, seed/ingest command)
12. Project structure
13. Limitations & roadmap
14. Data attribution (Google Maps, Wikivoyage CC BY-SA, Open-Meteo) and license

### 5. Features that stand out in GenAI interviews
1. **Impact-aware partial re-planning** with a visual diff and a measured *stability score* — shows you understand agents operating on changing state, not just one-shot generation.
2. **"LLM proposes, code verifies"** — deterministic constraint validator + bounded repair loop, with before/after-repair violation rates in the README.
3. **What-if simulator** via dry-run state forks with side-by-side cost/coverage deltas.
4. **Verifiable grounding** — provider-agnostic `source_id` citation contract, enforced by a Ground node and evaluated for precision/coverage.
5. **Eval + cost discipline** — golden datasets, retrieval ablation (vector vs hybrid), reproducible fixture-based evals in CI, and per-itinerary token/₹ cost surfaced in the UI and Langfuse. Bonus: the reusable MCP server.

---

## Verification (once implementation starts)
- `docker compose up` brings up postgres/pgvector, redis, mcp-server, api, web; `/health` green; MCP tools listable from the API and from an MCP inspector.
- Unit tests: validator/scheduler/diff engine (pure functions), MCP tools against recorded fixtures.
- E2E manual: create a 3-day Jaipur trip → check hours/travel/budget all satisfied, citations clickable → "simulate rain Day 2" → only outdoor Day-2 items change, diff shown → what-if "−₹15,000" → comparison without persisting → apply.
- `python evals/run_evals.py --dataset smoke` passes thresholds; full run produces `evals/reports/latest.md`; corresponding traces, token counts and costs visible in Langfuse.
