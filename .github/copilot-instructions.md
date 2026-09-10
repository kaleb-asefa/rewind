# Copilot Instructions — Rewind

Rewind is a Spotify listening-data analytics dashboard: vanilla JS/HTML/Tailwind frontend +
FastAPI/DuckDB backend. **Read `docs/AGENTS.md` first** — it is the project's constitution
(fixed tech stack, fixed Overview-page scope, design system, out-of-scope list). This file is
a supplement focused on commands and architecture; do not duplicate/override `docs/AGENTS.md`.

## Scoped agents (this repo uses split ownership)

- `.github/agents/backend.agent.md` — owns `backend/**` only.
- `.github/agents/frontend.agent.md` — owns `src/**`, `src/styles/**`, `*.html` only.
- `docs/API_CONTRACT.md` is the frontend↔backend seam (endpoint shapes). Update it *first*
  when a response shape changes; additive fields are safe, renames/removals are breaking.
- Never patch around the other domain's bug in your own scope — fix it at the source and
  hand off via the contract doc if needed.

## Build / test / lint

```bash
cd backend && uv sync                                  # install deps (uv-managed, Python 3.13+)
make serve                                              # run the single backend server on :8000 (kills stale one first)
cd backend && uv run fastapi dev main.py                # or: dev server directly
make test                                               # compile check + full pytest suite
cd backend && uv run pytest -q                          # full suite only
cd backend && uv run pytest -q -k test_top_artist_endpoint   # single test by name
npm install && npm run dev                              # frontend Vite dev server (Tailwind build), :5173
```
There is no bundler/build step for the JS itself — `src/js/**` files are loaded directly as
ordered `<script defer>` tags in the HTML pages (see below); Vite only compiles Tailwind CSS.
DuckDB is single-writer: only run one backend server at a time (`make serve` handles this).

## Architecture

- **Session model:** every `/api/**` request carries an `X-Rewind-Session: <uuid>` header
  (generated client-side, persisted in `localStorage`). The backend maps each ticket to its
  own private DuckDB file under `data/sessions/` via `backend/database.py` (`get_engine`,
  `TableRegistry`, `get_db` dependency). There is no shared user database.
- **Backend layering:** `main.py` (thin — app + middleware + `include_router` only) →
  `routers/{upload,overview,explore}.py` (endpoints, one router per domain) →
  `metrics.py` (framework-free computation: ranking, bar-race, heatmap, streaks, chronotype,
  timezone, genre bucketing — no FastAPI imports, unit-testable alone). `catalog.py` enriches
  uploaded history against a read-only 45M-track parquet catalog; `images.py` lazily fetches
  and caches Spotify oEmbed cover art per session.
- **Frontend layering:** no ES modules (pages open via `file://`, which blocks module CORS).
  Explore chapters attach to a shared `window.RewindExplore` namespace (`src/js/explore/core.js`
  first, then one file per chapter: `rhythm`, `sound`, `taste`, `behavior`, `discovery`, `life`).
  All API calls go through `window.fetchWithTimeout` from `src/js/api.js` — never hardcode the
  backend host elsewhere. `top_card.js`'s `initTopCard` factory renders top artist/album/track
  from one implementation, not three near-duplicates.
- **Empty-state contract:** metric endpoints never 500 on missing data — they return
  `{"status": "ok", ...}` with empty arrays / `null` scalars. The frontend renders the honest
  empty state (`chapterEmpty`, `#chart-empty`) and never shows fake data on real pages;
  `SAMPLE_*` constants only render when `window.REWIND_ALLOW_SAMPLE` is explicitly set.

## Key conventions

- Never string-interpolate request input into SQL; whitelist enum-like params
  (`entity`/`sort`/`range`) and return `400` on anything else.
- All blocking DuckDB/file/network work inside async routes runs via `run_in_threadpool`.
- Escape data-derived strings with `esc()` before `innerHTML` on the frontend (uploaded
  track/artist names are untrusted).
- `main.py` re-exports `_enrich_session` and `_WEEKDAY_NAMES` because `test_main.py` imports
  them directly — don't remove those re-exports when refactoring.
- Tests use a fixed ticket (`TEST_TICKET`) and an isolated `tmp_path` sessions dir
  (`database.SESSIONS_DIR` is monkeypatched); network calls for cover art are stubbed out.

## Reference docs (read before larger changes)

`docs/API_CONTRACT.md` (endpoint shapes), `docs/SCHEMA.md` (DuckDB columns),
`docs/BACKEND.md` (ingestion/architecture detail), `docs/CODE_QUALITY.md` (engineering rules
and current tech debt), `docs/design.md` (visual design system), `docs/UI_GUIDELINES.md` (copy).
