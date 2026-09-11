# Explore page — year filter (frontend handoff)

**Status:** backend is **done and live** on `work/backend`. Frontend side is **not started**.
**Owner of the remaining work:** frontend agent (`src/**`, `*.html`).
**Written by:** backend agent, as the handoff for a seam change.

Today every Explore chapter reports all-time numbers. The backend now accepts an optional
`year` filter on **every** Explore metric endpoint, plus a new endpoint that lists the years a
session actually has data for. This doc is everything the frontend needs to build the control
and wire it up — no backend reading required.

---

## 1. The API

### 1.1 `year` param — on every Explore endpoint

| | |
|---|---|
| Param | `year` (query string) |
| Values | `all` (**default**) or a 4-digit year, e.g. `2024` |
| Omitted / `year=all` | all-time — byte-for-byte the behaviour you have today |
| Invalid (`bogus`, `99`, `2024a`, `2024 OR 1=1`) | `400 {"detail": "Invalid year filter."}` |
| Echoed back | every response carries `"year": null` (all time) or `"year": 2024` |

Endpoints that take it (all of `backend/routers/explore.py`):

```
artist-rank   track-rank   bar-race    rhythm     audio        taste       behavior
discovery     listening-life  over-time  evolution  sound-detail  deep-cuts  wrapped
```

Examples:

```
GET /api/metrics/rhythm                 →  {"status":"ok","year":null, ...}   # all time
GET /api/metrics/rhythm?year=2024       →  {"status":"ok","year":2024, ...}
GET /api/metrics/bar-race?entity=track&limit=12&year=2024
```

`year` composes with the params you already send (`entity`, `limit`) — just append it.

> **Note:** `/api/metrics/chart` and `/api/metrics/superlatives` (Charts page) are **unchanged**
> — they keep their own `range=all|YYYY|4w|6m` param. Don't send `year` to those.

### 1.2 New: `GET /api/metrics/years`

Populates the filter. Newest first, one entry per year the session has plays in.

```json
{
  "status": "ok",
  "years": [
    { "year": 2026, "streams": 5632,  "minutes": 18840.28 },
    { "year": 2025, "streams": 2899,  "minutes": 8545.79 },
    { "year": 2024, "streams": 11734, "minutes": 27700.4 }
  ]
}
```

- `streams` = play count, `minutes` = listened minutes — use them for a subtitle/tooltip
  ("11,734 plays") or to de-emphasise a thin year. Both are optional to display.
- No upload yet → `{"status":"ok","years":[]}` (never a 500). Render "All time" alone.
- Year boundaries use the same local-time shift as the rest of the page (a play at 23:00 on
  Dec 31 counts in the year the user lived it), so these counts partition the history exactly:
  the sum of `streams` over all years equals the all-time `rhythm.total_streams`.

### 1.3 Empty-state contract (unchanged, now also per year)

A year with no data is **not** an error. `?year=1999` returns the same `status: "ok"` empty
shape a fresh session returns (`total_streams: 0`, `shuffle: null`, `concentration: {}`, …).
Keep using `chapterEmpty(sectionId, true)` for it — never fall back to `SAMPLE_*` on a real
page. Ideal copy for this case is "no listening in 1999", not "upload your history"; see
§4 and `docs/UI_GUIDELINES.md`.

---

## 2. What actually changes per chapter when a year is selected

Response **shapes never change** — only the numbers, and in two places the period labels.

| Chapter (section id) | Endpoint | Behaviour with `year=2024` |
|---|---|---|
| The Climb (`#climb`) | `artist-rank`, `track-rank`, `bar-race` | Frames are limited to that year: `months[]` starts `2024-01…` and ends `2024-12…`. The race restarts from zero on Jan 1 |
| When You Listen (`#rhythm`) | `rhythm` | Hours / weekdays / month-of-year, streaks and chronotype all computed inside the year. `monthly[12]` now reads as "this year's shape" |
| Your Sound (`#sound`) | `audio` | Averages + mood map over that year's plays; `coverage` is that year's catalog match rate |
| Your Taste (`#taste`) | `taste` | Genres, eras, gems for that year |
| How You Listen (`#habits`) | `behavior` | Shuffle / skip / attention / loops, and the longest binge **of that year** |
| Discovery (`#discovery`) | `discovery` | New-artist share and rediscoveries inside the year; "rising" compares the last 90 days of that year against the previous 90 |
| Listening Life (`#listening-life`) | `listening-life` | Peak day/week/month and session mix inside the year. Milestones are the 1k/5k/10k plays **of that year**, so a thin year may return fewer or none |
| Over Time (`#over-time`) | `over-time` | `years[]` collapses to a single card (that year), and **`nostalgia[].period` switches from `"2024"` to month labels `"Jan"…"Dec"`** |
| Taste Changes (`#evolution`) | `evolution` | **`genre_evolution.periods`, `mood_trend[].period`, `mainstream_trend[].period` switch from years to `"Jan"…"Dec"`** — same shape, month granularity, so a one-year view still draws a real trend |
| The Detail (`#sound-detail`) | `sound-detail` | Tempo spread, major/minor, danceable picks for that year |
| Deep Cuts (`#deep-cuts`) | `deep-cuts` | Concentration, album commitment, binged track, never-skipped favourite for that year |
| Wrapped (`#wrapped`) | `wrapped` | Personality traits + longest/shortest song for that year — i.e. an actual per-year "wrapped" |

Two consequences worth designing for:

1. **Over Time renders one year card** when filtered. That's honest, not a bug — but the
   chapter copy ("year by year") may want a lighter variant, or the chapter can note that
   the comparison view lives under "All time".
2. **Trend x-axes become months.** Both chapters already render `period` as an opaque string,
   so no parsing change is needed — but any hardcoded "year" wording in labels/tooltips
   (e.g. `period + ' · ' + pct`) should read generically.

---

## 3. Frontend work to do

### 3.1 The control

- A single filter for the **whole Explore page** — one selection drives every chapter.
  Not a per-chapter control.
- Options: **All time** (default, first, selected on load) then each year from
  `/api/metrics/years`, newest first.
- Style per `docs/design.md`: pill geometry, Spotify Green only for the active state
  (the chapter nav pills in `explore.html` are the precedent — `.chapter-pill`).
  A horizontally scrollable pill row matches the existing chapter nav; a compact
  `<select>`-style dropdown is acceptable if the year count grows.
- Placement: in the sticky chapter-nav area of `explore.html`, so it stays reachable while
  scrolling. It must not push the nav pills off-screen on mobile.
- Accessibility: the active option needs `aria-pressed`/`aria-current`, and the control needs
  a label ("Filter by year").

### 3.2 State + wiring

- Keep the selected year in one place (suggest `window.RewindExplore.year`, `null` = all time)
  and persist it in `localStorage` (e.g. `rewind_explore_year`) so a reload keeps the view.
  Validate on read — a stored year no longer in `/api/metrics/years` must fall back to all time.
- `core.js` already has the re-fetch hook: `init()` registers every chapter's `fetch` against
  the `rewind:data-updated` event. On a year change, update the shared state, then
  `window.dispatchEvent(new Event('rewind:data-updated'))` — every chapter refetches. No
  per-chapter event plumbing needed.
- Add one helper in `core.js` and use it everywhere instead of hand-building the query string:

  ```js
  // core.js — appends the active year to any metrics path
  function withYear(path) {
      const y = E.year;
      if (!y) return path;                       // all time → unchanged URL
      return path + (path.includes('?') ? '&' : '?') + 'year=' + encodeURIComponent(y);
  }
  ```

  Then: `fetcher(withYear('/api/metrics/rhythm'))`,
  `fetcher(withYear('/api/metrics/bar-race?entity=' + entity + '&limit=12'))`.

- **Files to touch** (every current caller):
  `src/js/explore/core.js` (state + helper + control wiring),
  `rhythm.js`, `sound.js`, `taste.js`, `behavior.js`, `discovery.js`, `life.js`,
  `over_time.js`, `evolution.js`, `sound_detail.js`, `deep_cuts.js`, `wrapped.js`,
  plus the climb chapter, which lives outside `explore/`:
  `src/js/velocity.js` (`/api/metrics/track-rank`, `/api/metrics/artist-rank`) and
  `src/js/bar_race.js` (`/api/metrics/bar-race`). `explore.html` for the control markup.
- Keep using `window.fetchWithTimeout` (and the existing defensive `fetcher` fallback) —
  don't introduce a new client or hardcode the host.
- Guard against out-of-order responses: a fast click through years can land an old response
  after a newer one. Stamp each request with the year it was issued for and drop the result if
  the active year has moved on.

### 3.3 Loading, empty and error states

- Show the existing skeletons while a switch is in flight rather than leaving stale numbers
  from the previous year on screen.
- Year with no data → `chapterEmpty(sectionId, true)` with year-aware copy
  ("No listening in 2019"), not the upload prompt.
- A `400` should be impossible from the UI (options come from the API) — if one happens,
  fall back to All time rather than leaving the page blank.
- Anything that prints "all time" in copy (chapter intros, the share card, tooltips) should
  read the selected year instead when one is active.

### 3.4 Acceptance checklist

- [ ] "All time" is the default on first visit and matches today's numbers exactly.
- [ ] Selecting a year refetches **all 12 chapters** (no chapter left on stale data).
- [ ] The climb race's frames stay inside the selected year.
- [ ] Over Time / Taste Changes render month labels (`Jan…Dec`) without layout breakage.
- [ ] A year with no data shows the honest empty card, never sample data.
- [ ] The selection survives a reload, and an unknown stored year degrades to All time.
- [ ] Rapid year switching never leaves a chapter showing another year's numbers.

---

## 4. Local testing

One server, from `../rewind-backend`:

```bash
make serve          # 127.0.0.1:8000
```

Then open `explore.html` via `file://` as usual. Direct checks:

```bash
S='X-Rewind-Session: <your uuid from localStorage["rewind_session"]>'
curl -s -H "$S" 'http://127.0.0.1:8000/api/metrics/years'
curl -s -H "$S" 'http://127.0.0.1:8000/api/metrics/rhythm?year=2024'
curl -s -H "$S" 'http://127.0.0.1:8000/api/metrics/evolution?year=2024'   # months, not years
curl -s -o /dev/null -w '%{http_code}\n' -H "$S" \
     'http://127.0.0.1:8000/api/metrics/rhythm?year=bogus'                # 400
```

---

## 5. Contract bookkeeping

`docs/API_CONTRACT.md` is a shared file and lands on `main` first, so it has **not** been
edited on `work/backend`. When the human is ready, §3's "Explore + Charts" table needs:

- a `year?` entry in the **Params** column of all 14 Explore rows,
- a new row `| /api/metrics/years | — | years[{year,streams,minutes}] |`,
- a note that every Explore response echoes `year` (int\|null) and that `over-time.nostalgia`
  / `evolution.*` periods switch to month labels when a year is selected.

Backend implementation lives in `backend/routers/explore.py` (`_parse_year`, `_year_clause`,
`_available_years`) and is covered by `backend/test_main.py`
(`test_years_*`, `test_year_filter_*`).
