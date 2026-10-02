# Waypoint: an AI travel planner that re-plans when things change

Tell it where you are going, your dates, budget and what you enjoy. It builds a day-by-day itinerary from real places, checks
every opening hour, travel time and cost **in code**, and cites where each recommendation came from. When the weather turns,
a stop closes or your budget shrinks, it works out **which stops are affected and re-plans only those**, then shows you a diff
before anything changes. An **edit agent** lets you change anything in the plan in plain words: add, move, retime, resize, annotate
or remove stops, add your own plans (a flight, a hotel check-in, dinner with friends), clear or swap days, and undo.

Python backend (FastAPI + LangGraph + MCP tools) and a React frontend with a designed motion system. It runs with **no API
keys** on a bundled demo dataset, and switches to OpenAI planning and live Google Maps data when you add keys.

![status](https://img.shields.io/badge/tests-99%20passing-2e9e6b) ![python](https://img.shields.io/badge/python-3.11-blue)

## Headline numbers

From `python -m evals.run_evals --suite full` (24 trips, 96 change requests, 158 itinerary edits, 24 retrieval queries; built-in
planner and rule router, demo data, so latency excludes any network calls to LLMs or map providers). Full report: [`backend/evals/reports/latest.md`](backend/evals/reports/latest.md).

| | |
|---|---|
| Plans with a hard violation (opening hours, budget, diet, access, travel limit) | **0 / 24** |
| Plans within budget / stops carrying a valid source | **100% / 100%** |
| Re-plan: affected-stop precision and recall (rain, closure) | **100% / 100%** |
| Re-plan: other stops left untouched (mean) | **99.0%** |
| Re-plan: budget target met, avoid-rules and pace respected | **100%** |
| Natural-language router accuracy | **100%** (96 cases) |
| Itinerary edits from prompts (move, retime, resize, note, add place, own entry, swap/clear day, remove, two-step): parsed / landed as asked | **100% / 100%** (158 cases, 0 hard violations) |
| Itinerary edits: other stops left in place (single-stop edits, mean) | **96.2%** |
| Rain re-plan: wet day left fully indoor | **50%** (see limitations) |
| Retrieval recall@3 (keyword / vector / hybrid, offline embedder) | 95.8% / 95.8% / 95.8% |
| Create latency p50 / p95, 9 tool calls per plan | 23 ms / 52 ms |

These are scores on datasets I wrote, with a planner that is deterministic by design. They show the guardrails hold; they do
not claim the plans are the best possible. The LLM planner is evaluated with the same harness (`--judge` adds an LLM-as-judge).
The re-plan stability figure was 96.4% in earlier reports: the eval shared one request object across cases, so a "more relaxed"
case leaked its pace into the cases after it. Each run now works on its own copy, and 99.0% is the corrected measurement.

## What it does

- **Personalised plan** from destination, dates, budget (₹), interests, pace, diet, step-free access and free-text notes.
- **Verified in code, not trusted from the model.** A scheduler sets the times; a validator checks opening hours, hop length,
  daily pace, budget, diet, access, avoided categories, duplicates and rain. The model proposes, code decides.
- **An edit agent for the whole itinerary (create, read, update, delete) in plain words.** "Move Amber Fort to day 3",
  "lunch at 1:30 on day 2", "spend 3 hours at City Palace", "add Panna Meena ka Kund to day 2", "add a flight to Mumbai at
  18:00 on day 4", "add a note to Amber Fort: book tickets online", "swap day 1 and day 2", "clear day 3", "we're vegetarian
  now", "remove X and add Y to day 3", plus questions ("is day 2 too packed?") answered from the plan with citations. With an
  OpenAI key it is a tool-calling agent (look up places, apply changes to a working draft, read what each change did, fix its own
  mistakes, then propose); without one, a rule router drives the same edit engine. Ambiguous requests get a clarifying question
  with tap-to-answer options, and the next message completes the change.
- **You stay in control.** Every edit is a proposal you preview on the timeline. Reply "yes" to accept or "no" to discard; "undo"
  or "go back to version 2" (or Restore in History) brings back an earlier version, including the budget and preferences saved
  with it. Stops you place or time yourself are never silently undone by the re-planner: if one breaks a rule (say it is closed
  at that hour) it stays, with a warning.
- **Impact-aware re-planning.** Rules decide which stops a change affects; only those slots are re-planned, other stops stay
  put. A stability score reports how much stayed the same. If no indoor swap exists, an outdoor stop can move to a dry day.
- **What if?** Same pipeline on a copy: cost bars, travel time, interest coverage and stability side by side. Nothing is
  saved until you apply it. Applied changes are versioned.
- **Alerts**: a weather watcher compares fresh forecasts to the plan and raises a proposal; "Simulate" lets you try it.
- **Sources on every stop** (place provider, forecast, guide passage) and a Wikivoyage-style guide index with hybrid retrieval.
- **Memory that you can see.** Thumbs up/down and removals move category weights and create inferred memories with their
  evidence. Everything is listed on the Memory page and deletable.
- **Cost and latency tracking** per run (tokens, USD, tool calls, repair loops, per-node time), optional Langfuse tracing.

## Architecture

```
┌──────────────────────── React (Vite, TypeScript, Tailwind 4, Framer Motion) ───────────────────┐
│ Auth · Trips · Wizard + live boarding pass · Agent progress · Workspace (timeline, chart map,   │
│ chat, what-if, history, simulate) · Memory                                                       │
└────────────────────────────────── REST + SSE (fetch stream) ───────────────────────────────────┘
                                          │
┌─────────────────────────────────── FastAPI (backend/src/travel_planner) ───────────────────────┐
│ JWT auth · quotas (Redis) · trips / versions / proposals · chat · what-if · feedback · memory   │
│ Weather watcher (asyncio task)                                                                   │
│                                                                                                  │
│  LangGraph                                                                                       │
│   create:  intake → research → plan ─► validate ⇄ repair_llm (≤2) → fix → ground                 │
│   change:  intake → research → impact → replan (partial, bounded repair) → ground                │
│   agent:   intake → research → agent_edit (tool loop over a working draft) → ground              │
│                                                                                                  │
│  deterministic core: scheduler · validator · editor (impact, CRUD ops, swap days, budget) · diff │
│  LLM (OpenAI, optional): plan/repair, replacement choice, edit agent (tool calling), Q&A         │
└───────────────┬──────────────────────────────────────────────┬──────────────────────────────────┘
                │ SQLAlchemy                                    │ tool calls: in-process or MCP
        ┌───────▼────────┐                              ┌───────▼───────── MCP server ───────────┐
        │ PostgreSQL     │                              │ geocode · search_places · routes ·      │
        │  + pgvector    │                              │ weather · currency · travel guides      │
        │ SQLite in dev  │                              │ Redis cache (memory fallback) · retries │
        └────────────────┘                              └──┬────────────┬──────────┬──────────────┘
                                                       Google Maps   Open-Meteo   Frankfurter
                                                       (or demo data)  (or synthetic)  (FX)
  Observability: per-run metrics in agent_runs, optional Langfuse traces. Embeddings: OpenAI or an offline hashed fallback.
```

### How a change flows

1. A message ("it's going to rain on day 2") goes to the router (LLM if configured, otherwise the rule parser) and becomes a
   structured `ChangeRequest`.
2. **Impact analysis** (rules) lists the affected stops with reasons: outdoor stops on a wet day, the closed stop, the least
   valuable stops per rupee for a budget cut, items matching a new "avoid".
3. **Partial re-plan**: replacements are searched only for those slots, from candidates that are already feasible (open, in
   budget, diet and access safe). With an LLM, it picks from that shortlist; otherwise the scorer does.
4. The whole day is re-scheduled, validated and repaired. A rain conflict with no indoor option is **kept with a warning**
   rather than silently dropped.
5. The result is stored as a *proposed* version with its diff. You preview it on the timeline and accept or dismiss.

### How the edit agent works

With an OpenAI key, a chat message goes to a tool-calling loop (`agent/edit_agent.py`, at most 8 turns) over a working copy of
the plan. Its tools are `view_itinerary`, `find_places`, `search_guides`, `apply_changes`, `check_plan` and `undo_step`, and it
finishes with one `reply`: a proposal, a clarifying question with options, a cited answer, or a short message. `apply_changes`
takes the same structured `Change` list the rule router produces, and runs it through the same engine (impact analysis, editor,
bounded repair), so the model never sets a time, a cost or an opening hour. Each result tells the model what moved and what broke,
so it can fix a mistake before proposing. If the model is unavailable, errors, or runs out of turns without changing anything, the
rule router answers instead. "yes", "no", "undo" and "go back to version N" are handled before any model call.

## Quick start

No keys needed. Python 3.11+, Node 20+.

```bash
# backend
cd backend
uv venv && uv pip install -e ".[dev]"            # or: python -m venv .venv && pip install -e ".[dev]"
uvicorn travel_planner.api.main:app --reload      # http://localhost:8000  (docs at /docs)

# frontend (another terminal)
cd frontend && npm install && npm run dev         # http://localhost:5173
```

Open the app and choose **Explore with a demo account**. Demo mode covers Jaipur, Goa, Tokyo and Paris.

**With keys** (copy `.env.example` to `.env`): `OPENAI_API_KEY` enables LLM planning, routing and Q&A;
`GOOGLE_MAPS_API_KEY` (Places API (New), Routes API, Geocoding API) enables any city with live hours and routing.

**Everything in containers** (PostgreSQL + pgvector, Redis, MCP server, API, web):

```bash
docker compose up --build        # http://localhost:8080
```

**Tests and evals**

```bash
cd backend
pytest -q                                          # 99 tests, includes the smoke-eval quality gate
TEST_DATABASE_URL=postgresql+psycopg://tp:tp@localhost:5432/tp pytest -q    # same suite on Postgres + pgvector
python -m evals.run_evals --suite full             # writes evals/reports/latest.{md,json}
python -m evals.run_evals --suite full --live --judge   # real providers + LLM judge (needs keys)
```

### Using the tools from an MCP client

```bash
cd backend && python -m travel_planner.mcp_server            # streamable HTTP on :8001/mcp
python -m travel_planner.mcp_server --stdio                  # stdio, for desktop clients
```

Eight typed tools: `geocode`, `search_places`, `find_place`, `get_place_details`, `compute_route_matrix`, `get_weather_forecast`,
`convert_currency`, `search_travel_guides`. Results are normalised (never raw provider JSON), carry a `source`, and failures
come back as `{error_code, message, retryable}`. Set `TOOLS_MODE=mcp` to make the agent itself use them through the server.

## API

| Method and path | Purpose |
|---|---|
| `POST /api/auth/register`, `/login`, `GET /api/me` | Accounts (argon2 hashes, signed JWT) |
| `POST /api/trips/stream` | Create a trip; Server-Sent Events: `stage` events, then `itinerary` or `error` |
| `GET /api/trips`, `/trips/{id}`, `DELETE` | List, open (itinerary, proposals, events, chat, last run), delete |
| `POST /api/trips/{id}/chat` | Natural-language edit or question → reply, optional proposal, agent steps and quick-reply options; "yes", "no", "undo" act on proposals |
| `POST /api/trips/{id}/whatif` | Same pipeline, framed as a scenario |
| `POST /api/trips/{id}/events/simulate` | Raise a rain or closure event and get a proposal |
| `POST /api/trips/{id}/versions/{vid}/apply` / `reject` | Promote or dismiss a proposal |
| `POST /api/trips/{id}/versions/{vid}/restore` | Propose going back to an earlier version (its stops and saved trip settings) |
| `GET /api/trips/{id}/versions` | History |
| `POST /api/trips/{id}/feedback`, `/items/{item}/lock` | Learn from a thumbs up or down; lock a stop |
| `GET/PUT /api/preferences`, `GET/POST/DELETE /api/memories` | Profile and learned memory |
| `GET /api/runs/summary`, `GET /api/meta` | Latency, tokens, cost, tool errors; data and planner mode |

## Project layout

```
backend/
  src/travel_planner/
    api/            FastAPI app, routes, auth, quotas
    agent/          LangGraph graph, research, router, edit agent (tool loop), LLM gateway + prompts, MCP-or-direct tool client
    services/       scheduler, validator, planner, editor, diff, memory, rag, embeddings, orchestrator, watcher, tracking
    tools/          tool functions, providers (google, open_meteo, frankfurter, demo), demo dataset
    mcp_server.py   standalone MCP server over the same tool functions
  evals/            datasets, metrics, optional LLM judge, runner, committed report
  tests/            unit, edit ops, router, tools/RAG, LLM path and agent loop (scripted model), API end to end, eval gate
frontend/           React app (pages, trip components, design tokens, motion helpers)
docker-compose.yml  Postgres+pgvector, Redis, MCP server, API, web
docs/               original implementation plan
```

## Design decisions and trade-offs

| Decision | Why | Cost |
|---|---|---|
| The model proposes, deterministic code verifies | Hours, hops and budget are facts; a model can be wrong about them | More code; the planner can only choose from candidates it was given |
| Research is code-driven and parallel, not an open tool loop | Faster, cheaper, reproducible from the tool cache | Less "agentic" for the planning step |
| Rule-based impact analysis, then a partial re-plan | Stable plans and a measurable stability score | Rules need maintenance as new change types appear |
| Proposals as versions instead of a graph interrupt | Survives refresh and restart; trivial history and diffs | A little more persistence code |
| The edit agent calls one `apply_changes` tool with the router's `Change` schema | One edit engine for the model and the rules; the model sees each result and can correct itself | The model can only make edits the engine supports |
| Stops you placed or timed yourself are kept and warned about, never auto-repaired away | An explicit request should not be silently undone | A plan can end with a warning the user has to read |
| Offline-first: a demo dataset and built-in planner | Anyone can run, test and evaluate it with no keys or spend | Demo data is small; real quality needs the live providers |
| Stylised SVG chart instead of map tiles | No tile service or key, animates cleanly, works offline | Not a street map; swap in Google Maps JS for live deployments |
| Memory weights move at half speed on tags vs the place type | One disliked museum should not become "dislikes history" | Needs several signals to infer a preference |
| MCP pinned to v1 (`mcp<2`) | v2 renamed the server API; v1 is verified here | Revisit when v2 stabilises |

## What is verified, and what is not

**Exercised in this repo:** 99 tests pass on SQLite (the earlier 50-test suite also on PostgreSQL 16 with pgvector 0.6, columns `vector(1536)`); the edit
agent's loop with a scripted model (look-up, apply, undo, clarify, cited answers, rejected invented places, fallback to rules);
the chat edit flows end to end in a real browser (move, accept with "yes", own entry, note, clarify chips, undo, restore); the
Redis cache backend; an MCP server and client round trip over streamable HTTP; the LLM planning path with a stubbed model
(grounding of invented places and citations, the repair loop, and fallback to the built-in planner); the full UI in a real
browser in light and dark themes and at phone width, with no console errors; a clean install of the package with its extras;
Langfuse callback attachment with fake keys and an unreachable host (a run still completes).

**Not exercised, because no credentials or services were available:** real OpenAI calls (the prompts, structured-output
schemas and the edit agent's strict tool schemas are written but unproven against a live model); the Google Places, Routes and Geocoding adapters (written against the
documented request and response shapes, never called); live Open-Meteo and Frankfurter responses; trace content in a real
Langfuse project; building the Docker images (`docker compose config` validates, but there was no daemon).

## Known limitations

- **Rain re-plans resolve about two thirds of affected outdoor stops** (the wet day ends fully indoor in 50% of eval cases).
  When no indoor swap fits, the stop stays with a warning instead of being dropped. A larger place set (live data) helps; so
  would letting the planner offer "drop it" as an explicit option.
- The demo dataset has 17 to 23 places per city, so a 4-day plan in a small city uses most of it. Tight budgets in expensive
  cities produce light days, and the plan says so.
- Intake from the free-text box is rule-based (diet, access, "no early mornings", things to skip). An LLM intake step is a
  natural next addition.
- Your own entries (a flight, a check-in) sit at a named place if you give one, otherwise at the trip centre, so travel to them
  is an estimate. The trip length is fixed after creation: the agent can clear or swap days but not add or remove them yet.
- The offline router understands common phrasings and asks when it is unsure; unusual wording needs the LLM agent.
- Offline retrieval uses a hashed bag-of-words embedder. Hybrid does not beat keyword search with it; semantic gains need real
  embeddings, which are not measured here.
- Schema creation uses `create_all`; there are no Alembic migrations yet. Ranking for hybrid retrieval runs in Python over one
  destination's chunks (embeddings are stored in pgvector; a native `<=>` query is a small change).
- Google place content is cached for an hour and only place ids are stored long term. Showing Google data on a map needs a
  Google map to meet the platform terms, which the stylised chart does not provide.

## Data and attribution

Demo places and guide notes are original summaries written for this project, with approximate coordinates and rough costs;
they are not Google or Wikivoyage content. Live mode uses Google Maps Platform, Open-Meteo and Frankfurter under their terms.
No licence has been chosen for this repository yet.
