# Rewind — Agent Instructions

## What This Project Is

Rewind is a **Spotify listening data analytics and visualization tool**. Users either connect their Spotify account for quick insights or upload their full Spotify data export (Extended Streaming History) for deep, long-term analytics. This is a **data analysis project**, not a generic music app, a social platform, or a music player.

Two pages exist right now:
- **Landing page** — explains the product, offers "Quick Insights" (login) vs "Deep Dive" (upload data export), includes instructions for requesting Spotify data.
- **Overview page** — the analytics dashboard itself.

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

## Out of Scope (for now)

These are common suggestions that are deliberately not being built yet. Do not implement any of these without explicit instruction, even if they seem like a natural addition:

- User accounts, authentication, or authorization
- Social/community features (leaderboards, sharing, comments, following)
- Mobile app or native builds
- Any page beyond the landing page and Overview page

## Project Structure

- `index.html` — landing page
- `upload.html` — standalone upload page (legacy fallback)
- `overview.html` — analytics dashboard & single-page application host
- `docs/` — all project documentation
  - `design.md` — visual design system (source of truth for styling)
  - `CODE_QUALITY.md` — code quality & engineering rules for all new code (backend + frontend); read before building
  - `UI_GUIDELINES.md` — UI copy & visual/clutter rules
  - `CHARTS.md` — Charts feature spec + creative numbered-leaderboard idea catalog (planned)
  - `BACKEND.md` — backend architecture and data-handling decisions
  - `SCHEMA.md` — data schema and column-by-column storage decisions
  - `AGENTS.md` — this file
- `src/` — Tailwind entry CSS and modular JavaScript source code
  - `js/api.js` — centralized API client with timeout support and error handling
  - `js/share.js` — builds the shareable "Your Rewind" snapshot card and exports it as a PNG
  - `js/total_time.js` — total listening time metric component & skeleton state handler
  - `js/top_card.js` — shared "Top X" card factory (`initTopCard`) rendering top artist/album/track
  - `js/heatmap.js` — GitHub-style listening activity heatmap component
  - `js/explore/` — Explore page chapter modules on a shared `window.RewindExplore` namespace: `core.js` (helpers, tooltip, reveal/scroll-spy, chapter registry) + one file per chapter (`rhythm`, `sound`, `taste`, `behavior`, `discovery`, `life`)
  - `js/upload.js` — multi-file upload drag-and-drop handler & status feedback
  - `js/theme.js` — dark mode theme toggler & local storage persistence
  - `js/spotlight.js` — spotlight search and keyboard shortcuts handler
- `backend/` — FastAPI backend implementation
  - `database.py` — Engine lifespan, TableRegistry, and `get_db` connection dependency
  - `main.py` — thin app entrypoint: middleware + `include_router` wiring only
  - `metrics.py` — framework-free computation helpers (ranking, bar-race, heatmap, streaks, chronotype, timezone, genre bucketing)
  - `routers/upload.py` — `/api/upload` ingest + enrich and `/api/image` cover art (holds `MAPPING`)
  - `routers/overview.py` — overview metrics (`total-time`, `top-*`, `total-songs`, `active-day`, `heatmap`)
  - `routers/explore.py` — explore metrics (`artist-rank`, `track-rank`, `bar-race`, `rhythm`, `audio`, `taste`, `behavior`, `discovery`, `listening-life`)
  - `test_main.py` — Pytest test suite covering upload and metric endpoints
  - `pyproject.toml` — dependencies managed via `uv`
- `data/` — persistent data storage
  - `sessions/` — session-scoped DuckDB storage (.duckdb files)
- `dist/` or `public/` — Vite build output

Keep this structure flat and predictable. New files should have an obvious reason to exist and a clear location; don't introduce new top-level folders without asking.

## General Rules for Agents

- Treat this file as the source of truth for scope and stack. If a request conflicts with it, flag the conflict rather than silently following the newer instruction.
- Prefer editing existing code over rewriting files from scratch.
- When in doubt about whether something is in scope, ask — don't assume and build.
- **This file is a rarely-edited constitution, not a per-task checklist.** Most requests should just be built directly using this file as background context — don't ask to update AGENTS.md for routine, in-scope work.
- If a request would change fixed scope, stack, or design (adding a new metric permanently, introducing a new library, starting backend work, etc.), **stop and ask first**: confirm whether this is a one-off exception or a permanent change. Only update this file if the user confirms it's permanent.
