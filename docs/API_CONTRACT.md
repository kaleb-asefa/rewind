# Rewind — API Contract (the frontend ↔ backend seam)

This is the **source of truth** that lets the frontend and backend be built in
parallel by separate agents. As long as both sides honor the shapes below,
neither needs to read the other's code.

- **Full field detail:** the endpoint functions in `backend/routers/` and
  `docs/BACKEND.md`. **Data columns:** `docs/SCHEMA.md`. This file is the index +
  the rules; the code is the detail.

---

## 1. Ownership map (who edits what)

| Area | Owner | Files |
|---|---|---|
| Backend | **backend agent** | `backend/**` (routers, `metrics.py`, `main.py`, `test_main.py`, `pyproject.toml`) |
| Frontend | **frontend agent** | `src/js/**`, `src/styles/**`, `*.html` |
| Contract / shared | **coordinate first** | this file, `docs/AGENTS.md`, `docs/SCHEMA.md`, `src/js/api.js` (base URL) |

**Hotspots — serialize edits (never two tasks at once):**
`backend/routers/explore.py`, `explore.html`, `charts.html`, `src/styles/main.css`.

---

## 2. Conventions (apply to every endpoint)

- **Base URL:** `http://127.0.0.1:8000`. Frontend always calls via
  `window.fetchWithTimeout(path)` (from `src/js/api.js`), never a raw hardcoded URL.
- **Session ticket (required):** every `/api/**` request must carry the header
  `X-Rewind-Session: <uuid>`. The frontend generates it once and persists it in
  `localStorage["rewind_session"]`, attaching it inside `window.fetchWithTimeout`:
  ```js
  let t = localStorage.getItem("rewind_session");
  if (!t) { t = crypto.randomUUID(); localStorage.setItem("rewind_session", t); }
  // fetchWithTimeout adds: headers: { "X-Rewind-Session": t }
  ```
  The ticket names the caller's private DuckDB file server-side, so each browser
  sees only its own upload. Missing/invalid ticket → `400`
  (`{"detail": "Missing or invalid session."}`); the frontend always sends one, so
  this only fires on direct/abusive calls. **No response shapes change.**
- **Method:** all metrics endpoints are `GET`. Upload is `POST`.
- **Success envelope:** `{ "status": "ok", ... }`.
- **Empty / no-data:** the endpoint returns `status:"ok"` with empty arrays or
  `null` scalars (e.g. `avg: null`, `shuffle: null`) — it does **not** 500.
- **Frontend behavior on empty/unreachable:** show the honest empty state
  (`chapterEmpty` / `#chart-empty` / the superlatives empty card). **Never render
  fake/sample data on the real pages.** Sample data only renders when
  `window.REWIND_ALLOW_SAMPLE` is set (only `explore_bento_sample.html`).
- **Params are whitelisted** server-side (e.g. `entity`, `sort`, `range`) → `400`
  on anything else. Never string-interpolate user input into SQL.
- **Timezone:** rhythm/heatmap/active-day bucket by local time via a per-user
  offset (`metrics._tz_offset_minutes`), inlined as a safe literal.

---

## 3. Endpoint index

### Overview (`backend/routers/overview.py`)

| Endpoint | Params | Key response fields |
|---|---|---|
| `/api/metrics/total-time` | — | `total_minutes` |
| `/api/metrics/top-artist` | — | `artist_name`, `artist_id`, `total_streams` |
| `/api/metrics/top-album` | — | `album_name`, `album_id`, `artist_name`, `total_minutes` |
| `/api/metrics/top-track` | — | `track_name`, `track_id`, `artist_name`, `total_streams` |
| `/api/metrics/total-songs` | — | `total_songs` |
| `/api/metrics/active-day` | — | `weekday`, `average_minutes`, `total_minutes` |
| `/api/metrics/heatmap` | `year?` | `years[]`, `year`, `active_days`, `total_streams`, `total_minutes`, `max_streams`, `days[{date,streams,minutes,level,top_track,top_artist}]` |

### Explore + Charts (`backend/routers/explore.py`)

| Endpoint | Params | Key response fields |
|---|---|---|
| `/api/metrics/artist-rank` | — | `months[]` (weekly keys), `data[{name,monthly_ranks[],image_url}]` |
| `/api/metrics/track-rank` | — | `months[]`, `data[{name,monthly_ranks[],image_url}]` |
| `/api/metrics/bar-race` | `entity`, `limit` | `months[]`, `featured[{name,id,cumulative_minutes[],image_url}]` |
| `/api/metrics/rhythm` | — | `hourly[24]`, `peak_hour`, `weekday[7]`, `busiest_weekday`, `monthly[12]`, `chronotype{label,position}`, `streak{longest,current,active_days}`, `total_streams` |
| `/api/metrics/audio` | — | `avg{energy,valence,danceability,acousticness,vocal}`, `tempo_avg`, `mode{major}`, `tracks[{name,valence,energy,plays}]`, `coverage`, `matched`, `total` |
| `/api/metrics/taste` | — | `genres[{name,plays}]`, `mainstream`, `distinct_genres`, `eras[{decade,plays}]`, `avg_year`, `gems[{name,artist,id,plays}]` |
| `/api/metrics/behavior` | — | `shuffle`, `skip_rate`, `longest_binge_min`, `attention{under30,partial,finished}`, `loops[{name,artist,id,count}]` |
| `/api/metrics/discovery` | — | `new_artist_share`, `new_artists_monthly`, `one_off_share`, `rediscoveries[]`, `rising[]` |
| `/api/metrics/listening-life` | — | `peaks[{label,minutes,period}]`, `typical_session_minutes`, `session_mix[]`, `milestones[]` |
| `/api/metrics/over-time` | — | `years[]`, `music_age`, `time_machine`, `nostalgia[]` |
| `/api/metrics/evolution` | — | `genre_evolution{periods,genres}`, `mood_trend[]`, `day_night`, `mainstream_trend[]` |
| `/api/metrics/sound-detail` | — | `tempo{buckets[]}`, `key{major_share}`, `danceable[]`, `energy_split{workout,wind_down}` |
| `/api/metrics/deep-cuts` | — | `concentration{top10_share}`, `album_commitment{deep_share}`, `top_day_track`, `no_skip` |
| `/api/metrics/wrapped` | — | `personality[]`, `longest_track`, `shortest_track` |
| `/api/metrics/chart` | `entity=artist\|track\|album\|genre`, `sort=minutes\|streams`, `limit`, `range=all\|YYYY\|4w\|6m` | `items[{rank,name,artist,id,minutes,streams,share,prev_rank,image_url}]`, `years[]` |
| `/api/metrics/superlatives` | `range`, `limit` | `obsession[]`, `binges[]`, `most_skipped[]`, `never_skipped[]`, `longest[]`, `shortest[]`, `years[]` |

> `image_url` (string\|null, additive): each item's cached cover URL, read-only from the `images`
> table by `(kind, spotify_id)`. `null` when the id is missing, not yet warmed, or a genuine
> art-less miss (`genre` items have no cover → always `null`). Never triggers an oEmbed fetch;
> resolve `null`s via the `/api/images` fallback.

### Ingest + images (`backend/routers/upload.py`)

| Endpoint | Params | Notes |
|---|---|---|
| `POST /api/upload` | JSON files | Ingest history + enrich; fires `rewind:data-updated` client-side on success. |
| `GET /api/image` | `kind`, `id` | Single cover URL (oEmbed, cached). |
| `GET /api/images` | `kind`, `ids` (csv, ≤200) | Batch → `{ images: { id: url } }`. Preferred (use `loadCoversBatch`). |

---

## 4. Changing the contract

A response shape is a shared interface. To change one:

1. **Edit this file first** (and note it in the PR/commit).
2. Backend implements + updates its pytest.
3. Frontend adapts its `fetch*`/`render*` to the new shape.
4. Merge backend and frontend together (or backend first, since the frontend
   tolerates missing fields via its empty-state guards).

Additive changes (new fields) are safe to ship without lockstep. Renames/removals
are breaking — coordinate.

---

## 5. Parallel-dev runbook

**Worktrees** (created for this setup):

- `../rewind-backend` on branch `work/backend`
- `../rewind-frontend` on branch `work/frontend`
- `main` (this folder) stays as the integration + live-data checkout.

**One server, one DB.** DuckDB is single-writer and `:8000` is one port, and
`data/` is gitignored (not copied into worktrees). So:

- Run **exactly one** backend server. `data/` is symlinked into `../rewind-backend`
  so you can run it from there:
  ```bash
  cd ../rewind-backend
  fuser -k 8000/tcp 2>/dev/null
  uv run --project backend uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
  ```
- The **frontend agent** never runs its own server — it opens its own
  `explore.html` / `charts.html` via `file://` (which call `:8000`) and edits JS/HTML.

**Backend loop (no browser, no data needed):**
```bash
cd ../rewind-backend/backend
uv run python -m py_compile main.py database.py metrics.py routers/*.py && uv run pytest -q
```

**Integrate often.** Rebase each branch onto `main` frequently; small merges avoid
painful conflicts on the hotspot files in §1.
