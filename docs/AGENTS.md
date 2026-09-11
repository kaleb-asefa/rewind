# Rewind — Agent Instructions

## What This Project Is

Rewind is a **Spotify listening data analytics and visualization tool**. Users either connect their Spotify account for quick insights or upload their full Spotify data export (Extended Streaming History) for deep, long-term analytics. This is a **data analysis project**, not a generic music app, a social platform, or a music player.

Five pages exist right now:
- **Landing page** (`index.html`) — explains the product and how to request a Spotify data export.
- **Upload page** (`upload.html`) — drag-and-drop ingest of the export files.
- **Overview page** (`overview.html`) — "Your Rewind", the snapshot dashboard (fixed scope below).
- **Explore page** (`explore.html`) — the scrollytelling deep dive (11 chapters + Wrapped finale).
- **Charts page** (`charts.html`) — numbered leaderboards, superlative records and the share deck.

## Current Stage

Backend implementation is active in `backend/` using **FastAPI**, **DuckDB**, and **SQLAlchemy Core**.

## Tech Stack (fixed — do not substitute or add to this)

- **Frontend:**
  - **Vanilla HTML/CSS/JS** — no framework (no React, Vue, Svelte, etc.)
  - **Tailwind CSS**, compiled via **Vite** — not the Tailwind CDN script
  - **Chart.js** (npm) — for any future line/trend charts. Not D3, not Recharts, not Plotly.
  - **Vanilla `fetch()`** — for calls to the FastAPI backend
- **Backend (`backend/`):**
  - **FastAPI** + **Uvicorn**
  - **DuckDB** + **SQLAlchemy Core** (`duckdb-engine`)
  - Package manager: **`uv`** (`pyproject.toml`)

This stack is a deliberate choice, not an oversight: the current scope does not require a framework's state-management overhead. Do not suggest or introduce a framework "for best practices" or "scalability" without an explicit request.

## Design — Locked to `docs/design.md`

All visual design must follow the Spotify-inspired design system in `docs/design.md`. This includes:
- Near-black surfaces (`#121212`–`#1f1f1f`), Spotify Green (`#1ed760`) as the **only** accent color, used functionally (CTAs, active states, play controls) — never decoratively
- Pill/circle geometry on buttons and controls
- Uppercase button labels with wide letter-spacing
- Heavy shadows for elevation on dark surfaces
- Compact, dense typography (10px–24px range)
- **Both themes ship from one token set** (`src/styles/main.css`: `:root` = light, `.dark` = dark,
  wired to Tailwind through `src/js/tailwind_config.js`). Never hardcode a colour — in CSS or in
  a JS chart renderer — and never mirror dark values into light: light mode inverts the elevation
  direction and deepens the accent. See `docs/design.md` §2A.

**Reference designs (Behance, Dribbble, or similar) may only be used to inform visual style** — spacing, color treatment, component shape, micro-interactions. **They must never be used to change scope, add sections, or restructure the project.** If a reference design suggests a different layout or new feature, treat that as inspiration to note and ask about — not something to implement automatically. This is the single most important rule in this document: a project has drifted into being rebuilt as a different product before because an agent adapted a reference design's *content*, not just its *style*.

## Code Quality — Follow `docs/CODE_QUALITY.md`

All new code (backend and frontend) must follow the engineering rules in `docs/CODE_QUALITY.md`:
keep `main.py` thin with domain routers + framework-free `metrics.py`; one component per file
(use a factory for duplicates); route all frontend fetches through `window.fetchWithTimeout`
(never hardcode the API host); no user input in SQL; escape data-derived HTML; keep tests green.
The doc also tracks known tech debt (CORS, hardcoded API host) — check it before building and
update it when debt is added or paid down.

## Parallel Development — Frontend / Backend split

Development can run in two scoped agents working in separate git worktrees:

- **Contract (source of truth):** `docs/API_CONTRACT.md` — the frontend ↔ backend seam
  (endpoint shapes + conventions). Change this file *first* when a response shape changes.
- **Scoped agents:** `.github/agents/backend.agent.md` (owns `backend/**`) and
  `.github/agents/frontend.agent.md` (owns `src/**` + `*.html`).
- **Ownership:** backend edits `backend/**`; frontend edits `src/**`, `src/styles/**`, `*.html`.
  Shared files (`docs/API_CONTRACT.md`, this file) are edited in `main` first, before branches diverge.
- **One server, one DB:** DuckDB is single-writer and `data/` is gitignored — run exactly one
  backend server (`:8000`); the frontend opens its own pages via `file://`.
- **Commit per testable chunk — the human merges.** Commit to your work branch as soon as a
  chunk stands on its own (builds / renders / passes its own tests), with a message that says
  what broke and why the fix works. Don't leave finished work uncommitted and don't bundle
  unrelated changes together. Merging and integration are the human's job: an agent never runs
  `make integrate`, `git merge`/`rebase`, or commits to `main` from a work branch. Shared-doc
  edits still land on `main` first, but only when the human asks for them.
- **Fix problems at their source — never stitch a cross-worktree workaround.** If the root
  cause, or the *most efficient* fix, lives in the other worktree's domain, do **not** patch
  around it in your own scope just because you technically can. Stop, say so, and hand the work
  to the correct agent (via `docs/API_CONTRACT.md` when the seam changes) — even if a local
  workaround would "work". Correctness and efficiency beat staying in your lane. Example: cover
  art arriving in partial waves is a backend fetch/cache concern (warm the cache server-side);
  the frontend must **not** hide it behind client retry/polling loops. Only a genuinely
  presentational fix (rendering, reveal timing, layout) stays with the frontend.

See `docs/API_CONTRACT.md` §5 for the worktree runbook.

## Fixed Scope — Overview Page

The Overview page shows exactly these metrics. No more, no less, unless explicitly requested:

1. Total listening time
2. Top artist
3. Top track
4. Top album
5. GitHub-style listening activity heatmap
6. Most hated artist (e.g. most skipped)
7. Most hated track
8. Number of active days
9. Number of unique songs

Do not add sections like leaderboards, social/community features, "personality profile" style cards, sharing features, or any other metric not on this list — even if they seem like a natural fit for a music analytics dashboard. If something seems missing or would improve the page, suggest it and wait for confirmation before building it.

This lock is about the **Overview page only**. The deep-dive metrics live on `explore.html`
(chapters) and `charts.html` (leaderboards, superlatives, share deck), which are built out
against `docs/CHARTS.md` and the analysis backlog — don't move their content onto Overview.

## Out of Scope (for now)

These are common suggestions that are deliberately not being built yet. Do not implement any of these without explicit instruction, even if they seem like a natural addition:

- User accounts, authentication, or authorization (the app is anonymous, one DuckDB file per
  `X-Rewind-Session` ticket — see `docs/MULTI_USER.md`)
- Social/community features (leaderboards across users, comments, following). The Charts page
  is a **personal** leaderboard, and sharing is limited to the locally generated image cards
  on `charts.html` — nothing is uploaded or published
- Mobile app or native builds
- Any page beyond the five listed above

## Project Structure

- `index.html` — landing page
- `upload.html` — standalone upload page
- `overview.html` — "Your Rewind" snapshot dashboard (scope locked below)
- `explore.html` — scrollytelling deep dive (11 chapters + the Wrapped finale)
- `charts.html` — numbered leaderboards, superlative records and the share deck
- `explore_bento_sample.html` — private layout mockup; the **only** page that sets
  `window.REWIND_ALLOW_SAMPLE` (and therefore the only page allowed to render `SAMPLE_*` data)
- `docs/` — all project documentation
  - `design.md` — visual design system (source of truth for styling)
  - `API_CONTRACT.md` — the frontend ↔ backend seam (endpoint shapes + conventions); change it first
  - `CODE_QUALITY.md` — code quality & engineering rules for all new code (backend + frontend); read before building
  - `UI_GUIDELINES.md` — UI copy & visual/clutter rules
  - `CHARTS.md` — Charts feature spec + creative numbered-leaderboard idea catalog
  - `BACKEND.md` — backend architecture and data-handling decisions
  - `MULTI_USER.md` — per-guest session model (`X-Rewind-Session` ticket, TTL cleanup, upload caps)
  - `FRONTEND_YEAR_FILTER.md` — handoff for the Explore year filter (backend done, frontend pending)
  - `SCHEMA.md` — data schema and column-by-column storage decisions
  - `analysis.md` / `ANALYSIS_IDEAS.md` — metric methodology + analysis backlog
  - `AGENTS.md` — this file
- `src/` — Tailwind entry CSS and modular JavaScript source code
  - `js/api.js` — centralized API client: `fetchWithTimeout` (attaches the session ticket) + the shared cover-art cache (`loadCoversBatch`, `primeCoverUrls`, `resolveCoverUrls`)
  - `js/tailwind_config.js` — the single shared Tailwind CDN config; every colour utility maps to a CSS custom property so both themes work. Load after the CDN script, **without `defer`**; pages must not re-declare their own config
  - `js/theme.js` — light/dark theme toggler & local storage persistence
  - `js/landing.js` — landing-page cassette-deck hero interactions
  - `js/upload.js` — multi-file upload drag-and-drop handler & status feedback
  - `js/total_time.js` — total listening time metric component & skeleton state handler
  - `js/top_card.js` — shared "Top X" card factory (`initTopCard`) rendering top artist/album/track
  - `js/behavior.js` — overview bottom cards (unique songs, most active day)
  - `js/heatmap.js` — GitHub-style listening activity heatmap component
  - `js/spotlight.js` — spotlight search and keyboard shortcuts handler
  - `js/velocity.js` + `js/bar_race.js` — Explore chapter 01 animations (rank velocity, bar race)
  - `js/explore/` — Explore page chapter modules on a shared `window.RewindExplore` namespace: `core.js` (helpers, tooltip, reveal/scroll-spy, chapter registry, `chapterEmpty`) + one file per chapter (`rhythm`, `sound`, `taste`, `behavior`, `discovery`, `life`, `over_time`, `evolution`, `sound_detail`, `deep_cuts`, `wrapped`)
  - `js/charts.js` — Charts leaderboard (entity/sort/depth/range controls, find-your-rank search)
  - `js/charts_superlatives.js` — the superlative record cards on the Charts page
  - `js/charts_share.js` — canvas-drawn Wrapped-style share deck (per-card + per-year recap cards)
- `backend/` — FastAPI backend implementation
  - `database.py` — per-ticket engine cache, `TableRegistry`, `get_db` dependency, session TTL cleanup
  - `main.py` — thin app entrypoint: middleware + `include_router` wiring only
  - `metrics.py` — framework-free computation helpers (ranking, bar-race, heatmap, streaks, chronotype, timezone, genre bucketing)
  - `catalog.py` / `images.py` — catalog enrichment on upload; cached Spotify oEmbed cover art
  - `covers.py` — cover **identity**: which Spotify id represents an album's art (id join, with a representative-track fallback)
  - `routers/upload.py` — `/api/upload` ingest + enrich (holds `MAPPING` and the upload caps) and `/api/image` + `/api/images` cover art
  - `routers/overview.py` — overview metrics (`total-time`, `top-*`, `total-songs`, `active-day`, `heatmap`)
  - `routers/explore.py` — explore + charts metrics (`years`, `artist-rank`, `track-rank`, `bar-race`, `rhythm`, `audio`, `taste`, `behavior`, `discovery`, `listening-life`, `over-time`, `evolution`, `sound-detail`, `deep-cuts`, `wrapped`, `chart`, `superlatives`); every explore endpoint takes the optional `year` filter
  - `test_main.py` — Pytest test suite covering upload and metric endpoints
  - `pyproject.toml` — dependencies managed via `uv`
- `data/` — persistent data storage
  - `sessions/` — one DuckDB file per session ticket (`<ticket>.duckdb`)
  - `metadata/` — read-only 45M-track catalog parquet used for enrichment
- `dist/` or `public/` — Vite build output

Keep this structure flat and predictable. New files should have an obvious reason to exist and a clear location; don't introduce new top-level folders without asking.

## General Rules for Agents

- Treat this file as the source of truth for scope and stack. If a request conflicts with it, flag the conflict rather than silently following the newer instruction.
- Prefer editing existing code over rewriting files from scratch.
- When in doubt about whether something is in scope, ask — don't assume and build.
- **This file is a rarely-edited constitution, not a per-task checklist.** Most requests should just be built directly using this file as background context — don't ask to update AGENTS.md for routine, in-scope work.
- If a request would change fixed scope, stack, or design (adding a new metric permanently, introducing a new library, starting backend work, etc.), **stop and ask first**: confirm whether this is a one-off exception or a permanent change. Only update this file if the user confirms it's permanent.
