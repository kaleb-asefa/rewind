# Explore page — year filter

**Status:** ✅ **done on both sides** — the backend ships `year=all|YYYY` on every Explore
endpoint plus `/api/metrics/years`, and `explore.html` now drives all twelve chapters from one
control in the sticky chapter rail. Kept as the reference for *how* the filter behaves.
**Originally written by:** the backend agent, as the handoff for a seam change.

The backend accepts an optional `year` filter on **every** Explore metric endpoint, plus an
endpoint that lists the years a session actually has data for. §1–§2 describe that API, §3
describes the shipped frontend.

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
    { "year": 2026 },
    { "year": 2025 },
    { "year": 2024 }
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
| Wrapped (`#wrapped`) | `wrapped` | Personality traits for that year — i.e. an actual per-year "wrapped" |

Two consequences worth designing for:

1. **Over Time renders one year card** when filtered. That's honest, not a bug — but the
   chapter copy ("year by year") may want a lighter variant, or the chapter can note that
   the comparison view lives under "All time".
2. **Trend x-axes become months.** Both chapters already render `period` as an opaque string,
   so no parsing change is needed — but any hardcoded "year" wording in labels/tooltips
   (e.g. `period + ' · ' + pct`) should read generically.

---

## 3. How the frontend is wired

### 3.1 The control

- One filter for the **whole Explore page** — a pill + dropdown (`#year-filter`,
  `#year-filter-btn`, `#year-filter-label`, `#year-filter-menu`) in the sticky chapter rail.
  "All time" first, then each year from `/api/metrics/years`.
- The control stays **hidden until `/api/metrics/years` returns a year to pick**, and it
  initialises before the scroll-spy so a rail hiccup can't leave the page unfilterable.
- Styling follows the chapter pills (`.year-pill--active`, `.year-option--active` in
  `main.css`); the active option carries `aria-selected`.

### 3.2 State + wiring

`src/js/explore/core.js` owns all of it, on the `window.RewindExplore` (`E`) namespace:

| Piece | What it does |
|---|---|
| `E.year` | Single source of truth. `null` = all time, otherwise an int. Read from `localStorage["rewind_explore_year"]` **synchronously at load**, so a restored year is on the *first* request instead of flashing all-time data first. Junk or a year that's no longer in `/api/metrics/years` degrades to all time and refetches. |
| `E.withYear(path)` | Appends `year=` to any metrics path. Every chapter builds URLs with it — never hand-rolled query strings. |
| `E.token()` / `E.stale(t)` | Request stamping. A fetch takes a token before it starts and bails if `E.stale(tok)`, so clicking quickly through years can't land 2023's numbers under a 2026 label. |
| `E.chapterBusy(sectionId, isBusy, owner)` | Dims a chapter (`.chapter-busy`) while its switch is in flight. **Owner-keyed**, because chapter 01 loads the velocity chart and the bar race independently; a run that's already stale never lifts the dim. |
| `E.yearLabel()` | `"All time"` or `"2024"` — used in copy such as the race header. |

Changing the year bumps the token, persists the value, re-renders the control and dispatches
`rewind:data-updated` — the existing post-upload refresh hook — so all chapters refetch with no
per-chapter event plumbing. Callers outside `explore/` (`velocity.js`, `bar_race.js`) use the
same helpers; the climb **replaces** its frame list rather than merging it, so a filtered year
can't keep last year's months.

### 3.3 Loading, empty and error states

- Chapters dim while a switch is in flight instead of showing the previous year's figures as
  if they were the new ones.
- Year with no data → `chapterEmpty(sectionId, true)` renders year-aware copy
  ("No listening in 2019" + a way back to all time), never sample data.
- A `400` is unreachable from the UI (options come from the API); a stored/unknown year falls
  back to all time rather than leaving the page blank.

### 3.4 Acceptance checklist

Verified against the live backend with a jsdom harness driving the real page:

- [x] "All time" is the default on first visit and matches the pre-filter numbers exactly.
- [x] Selecting a year refetches **all 12 chapters** / 14 endpoints with `year=`.
- [x] The climb race's frames stay inside the selected year.
- [x] Over Time / Taste Changes render month labels (`Jan…Dec`) without layout breakage.
- [x] A year with no data shows the honest empty card, never sample data.
- [x] The selection survives a reload, and an unknown stored year degrades to All time.
- [x] Rapid switching settles on the last click with nothing left dimmed.

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

`docs/API_CONTRACT.md` is **up to date** as of this doc's last edit — it carries the `year?`
param on every Explore row, the `/api/metrics/years` row, and the §2 convention note (every
Explore response echoes `year` (int|null); `over-time.nostalgia` / `evolution.*` periods switch
to month labels when a year is selected). Read the contract for the shapes; read this doc for
the UI work.

Backend implementation lives in `backend/routers/explore.py` (`_parse_year`, `_year_clause`,
`_available_years`) and is covered by `backend/test_main.py`
(`test_years_*`, `test_year_filter_*`).
