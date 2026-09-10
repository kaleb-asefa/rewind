# Copilot Instructions — Rewind

Rewind is a Spotify listening-data analytics dashboard: vanilla JS/HTML/Tailwind frontend +
FastAPI/DuckDB backend. **Read `docs/AGENTS.md` first** — it is the project's constitution
(fixed tech stack, fixed Overview-page scope, design system, out-of-scope list). This file is
a supplement focused on commands and architecture; do not duplicate/override `docs/AGENTS.md`.

## Worktrees & agent ownership (check this BEFORE editing any file)

Development runs as two scoped agents in **separate git worktrees** of the same repo.
Always confirm which worktree/branch you are in (`git rev-parse --show-toplevel`,
`git branch --show-current`) and edit only the paths you own.

| Worktree | Branch | Agent | Owns (may edit) |
|---|---|---|---|
| `../rewind` | `main` | — | integration + live-data checkout; shared docs land here first |
| `../rewind-backend` | `work/backend` | `.github/agents/backend.agent.md` | `backend/**` only |
| `../rewind-frontend` | `work/frontend` | `.github/agents/frontend.agent.md` | `src/**`, `src/styles/**`, `*.html` only |

- **Never edit outside your worktree's scope**, even if the fix is trivial and you technically
  can. Hand it to the owning agent instead.
- **Never stitch a cross-domain workaround.** If the root cause (or the most efficient fix)
  lives in the other domain, stop and hand it over — client retry loops for a server-side
  caching problem, or presentation-only fields bent into the API, are both violations.
  Only genuinely presentational fixes (rendering, reveal timing, layout) stay with frontend.
- `docs/API_CONTRACT.md` is the frontend↔backend seam and the handoff mechanism. Update it
  *first* when a response shape changes; additive fields are safe, renames/removals are breaking.
- **Shared files** (`docs/API_CONTRACT.md`, `docs/AGENTS.md`, `docs/SCHEMA.md`) are edited in
  `main` **first**, before branches diverge — not on a work branch.
- Worktree commands: `make sync` (rebase a work branch onto main), `make integrate` (from
  `main`: merge both work branches + run tests), `make serve` (the single :8000 server).
- **One server, one DB.** DuckDB is single-writer and `data/` is gitignored, so exactly one
  backend server runs (from `../rewind-backend`, where `data/` is symlinked). The frontend
  agent never starts its own server — it opens its pages via `file://` against `:8000`.

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
- Metric components use `const fetcher = window.fetchWithTimeout || (async (ep) => {...})` —
  the inline raw `fetch` is a **defensive fallback** for when `api.js` hasn't loaded, not a
  bypass. Don't mistake it for a component that skips the shared client. `upload.js` is the
  one real exception: it posts `FormData` with a raw `fetch` because `fetchWithTimeout`'s 5s
  abort would kill a large history upload.
- `main.py` re-exports `_enrich_session` and `_WEEKDAY_NAMES` because `test_main.py` imports
  them directly — don't remove those re-exports when refactoring.
- Tests use a fixed ticket (`TEST_TICKET`) and an isolated `tmp_path` sessions dir
  (`database.SESSIONS_DIR` is monkeypatched); network calls for cover art are stubbed out.

## Reference docs (read before larger changes)

`docs/API_CONTRACT.md` (endpoint shapes), `docs/SCHEMA.md` (DuckDB columns),
`docs/BACKEND.md` (ingestion/architecture detail), `docs/CODE_QUALITY.md` (engineering rules
and current tech debt), `docs/design.md` (visual design system), `docs/UI_GUIDELINES.md` (copy).
