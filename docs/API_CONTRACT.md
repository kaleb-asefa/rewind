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
- **Year filter (Explore only):** every endpoint in `routers/explore.py` takes
  `year=all` (default, all time) or a 4-digit year. Anything else → `400`
  (`{"detail": "Invalid year filter."}`). Every response echoes `"year": null|2024`.
  Response **shapes never change** — only the numbers, plus the period labels of
  `over-time.nostalgia[].period` and `evolution` (`genre_evolution.periods`,
  `mood_trend[].period`, `mainstream_trend[].period`), which switch from years to
  month labels (`"Jan"…"Dec"`) when a year is selected. A year with no plays is
  **not** an error — it returns the normal empty shape. `/api/metrics/years` lists
  the options. The Charts endpoints (`chart`, `superlatives`) are **not** part of
  this — they keep their own `range=all|YYYY|4w|6m`. Client side, the Explore page
  sends it through `E.withYear(path)` and drops out-of-order responses via
  `E.token()`/`E.stale()` — see `docs/FRONTEND_YEAR_FILTER.md`.
- **Timezone:** rhythm/heatmap/active-day/year-boundaries bucket by local time via a
  per-user offset (`metrics._tz_offset_minutes`), inlined as a safe literal.

---

## 3. Endpoint index

### Overview (`backend/routers/overview.py`)

| Endpoint | Params | Key response fields |
|---|---|---|
| `/api/metrics/total-time` | — | `total_minutes` |
| `/api/metrics/top-artist` | — | `artist_name`, `artist_id`, `total_streams` |
| `/api/metrics/top-album` | — | `album_name`, `album_id`, `artist_name`, `total_minutes`, `cover_kind`, `cover_id` |
| `/api/metrics/top-track` | — | `track_name`, `track_id`, `artist_name`, `total_streams` |
| `/api/metrics/total-songs` | — | `total_songs` |
| `/api/metrics/active-day` | — | `weekday`, `average_minutes`, `total_minutes` |
| `/api/metrics/heatmap` | `year?` | `years[]`, `year`, `active_days`, `total_streams`, `total_minutes`, `max_streams`, `days[{date,streams,minutes,level,top_track,top_artist}]` |

> The heatmap's `year` is its own integer calendar selector (out-of-range → falls back to the
> newest year), **not** the Explore year filter in §2.

### Explore + Charts (`backend/routers/explore.py`)

`year?` below is the shared Explore filter described in §2 (`all` default, or `YYYY`).

| Endpoint | Params | Key response fields |
|---|---|---|
| `/api/metrics/years` | — | `years[{year}]` (newest first; `[]` before any upload) |
| `/api/metrics/artist-rank` | `limit`, `year?` | `months[]` (weekly keys), `data[{name,monthly_ranks[],image_url}]` |
| `/api/metrics/track-rank` | `limit`, `year?` | `months[]`, `data[{name,monthly_ranks[],image_url}]` |
| `/api/metrics/bar-race` | `entity`, `limit`, `year?` | `months[]`, `featured[{name,id,cumulative_minutes[],image_url}]` |
| `/api/metrics/rhythm` | `year?` | `hourly[24]`, `peak_hour`, `weekday[7]`, `busiest_weekday`, `monthly[12]`, `chronotype{label,position}`, `streak{longest,current,active_days}`, `total_streams` |
| `/api/metrics/audio` | `year?` | `avg{energy,valence,danceability,acousticness,vocal}`, `tempo_avg`, `mode{major}`, `tracks[{name,valence,energy,plays}]`, `coverage`, `matched`, `total` |
| `/api/metrics/taste` | `year?` | `genres[{name,plays}]`, `mainstream`, `distinct_genres`, `eras[{decade,plays}]`, `avg_year`, `gems[{name,artist,id,plays}]` |
| `/api/metrics/behavior` | `year?` | `shuffle`, `skip_rate`, `longest_binge_min`, `attention{under30,partial,finished}`, `loops[{name,artist,id,count}]` |
| `/api/metrics/discovery` | `year?` | `new_artist_share`, `new_artists_monthly`, `one_off_share`, `rediscoveries[]`, `rising[]` |
| `/api/metrics/listening-life` | `year?` | `peaks[{label,minutes,period}]`, `typical_session_minutes`, `session_mix[]`, `milestones[]` |
| `/api/metrics/over-time` | `year?` | `years[]`, `music_age`, `time_machine`, `nostalgia[]` (periods → months when filtered) |
| `/api/metrics/evolution` | `year?` | `genre_evolution{periods,genres}`, `mood_trend[]`, `day_night`, `mainstream_trend[]` (periods → months when filtered) |
| `/api/metrics/sound-detail` | `year?` | `tempo{buckets[]}`, `key{major_share}`, `danceable[]`, `energy_split{workout,wind_down}` |
| `/api/metrics/deep-cuts` | `year?` | `concentration{top10_share}`, `album_commitment{deep_share}`, `top_day_track`, `no_skip` |
| `/api/metrics/wrapped` | `year?` | `personality[]` |
| `/api/metrics/chart` | `entity=artist\|track\|album\|genre`, `sort=minutes\|streams`, `limit`, `range=all\|YYYY\|4w\|6m` | `items[{rank,name,artist,id,cover_kind,cover_id,minutes,streams,share,prev_rank,image_url}]`, `years[]` |
| `/api/metrics/superlatives` | `range`, `limit` | `obsession[]`, `binges[]`, `most_skipped[]`, `never_skipped[]`, `years[]` |

> **Album cover ids (`cover_kind` / `cover_id`, additive).** Album items (`top-album`,
> `chart?entity=album`, `bar-race?entity=album`) carry them alongside `id`. `id` still means
> the real Spotify **album** id and is now resolved by identity
> (`track_uri → track_features.track_id → album_id`, most-played edition wins) instead of by
> matching album/artist name strings, which disagreed between the export and the catalog
> ("Take Care" vs "Take Care (Deluxe)", "Giveon" vs "GIVĒON") and silently produced `null`.
> For an album the catalog doesn't know (released after the catalog snapshot) `id` is `null`
> and `cover_kind: "track"` + `cover_id` point at one of the album's own tracks — a track's
> oEmbed thumbnail *is* its album cover, so the art is identical. **Clients that resolve art
> themselves should prefer `cover_id`/`cover_kind` over `id`**; `image_url` already accounts
> for it. Other entities don't set these fields (fall back to `id` + the endpoint's kind).

> `image_url` (string\|null, additive): each item's cached cover URL, read-only from the `images`
> table by `(kind, spotify_id)`. `null` when the id is missing, not yet warmed, or a genuine
> art-less miss (`genre` items have no cover → always `null`). Never triggers an oEmbed fetch;
> resolve `null`s via the `/api/images` fallback.

### Ingest + images (`backend/routers/upload.py`)

| Endpoint | Params | Notes |
|---|---|---|
| `POST /api/upload` | JSON files | Ingest history + enrich; fires `rewind:data-updated` client-side on success. Capped — see below. |
| `GET /api/image` | `kind`, `id` | Single cover URL (oEmbed, cached). |
| `GET /api/images` | `kind`, `ids` (csv, ≤200) | Batch → `{ images: { id: url } }`. Preferred. |

> **Upload caps.** `POST /api/upload` accepts at most `REWIND_MAX_UPLOAD_FILES` (default 50)
> `.json` files totalling `REWIND_MAX_UPLOAD_MB` (default 512 MB) — over either → `413`
> (`{"detail": …}`), enforced both by a `Content-Length` middleware and again while streaming
> the bytes actually received. A non-`.json` file or an empty request → `400`. The frontend
> should surface the `detail` string as-is rather than a generic failure.

> Client helpers (`src/js/api.js`) — all share one in-memory cache, chunk ids 8 at a time and
> cap concurrency at 3. Use them; never call `/api/images` by hand.
> `coverRef(item, defaultKind) → {kind, id}` answers *which id holds this item's art*
> (`cover_id`/`cover_kind` when present, else `id` + the endpoint's kind) — **every** cover path
> goes through it, or albums with `id: null` silently render the placeholder.
> `loadCoversBatch(kind, nodes)` paints `<img>`/background nodes directly.
> `primeCoverUrls(kind, items)` seeds the cache from inline `image_url` values (no request),
> keyed by the cover's own kind.
> `resolveCoverUrls(kind, ids) → Promise<{id: url}>` returns raw URLs for non-DOM consumers
> (canvas share deck, prefetchers).

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
