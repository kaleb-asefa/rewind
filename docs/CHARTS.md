# Rewind — Charts (Numbered Leaderboards)

Spec + idea catalog for the **Charts** feature.
Status: **core built** — `charts.html` + `src/js/charts.js` + `GET /api/metrics/chart`
(Artists / Tracks / Albums / Genres, minutes/streams sort, all-time + per-year range,
depth toggle, find-your-rank search, podium, movement arrows). Superlative and creative
charts in §3.2–§3.7 are **not built yet**.
Follow `docs/UI_GUIDELINES.md` (copy/clutter) and `docs/CODE_QUALITY.md` (engineering) when building.

---

## 1. Why this exists (the gap)

Today the app only ever shows **#1**: `top-artist` / `top-album` / `top-track` in
`backend/routers/overview.py` use `LIMIT 1`. The bar-race and rank-velocity views are
**animations/graphs**, not something you can *scan*.

The signature Spotify Wrapped experience is the **numbered list** — "My Top Songs",
"#1 … #47 Artist" — and the ability to **look up any artist/track and see its exact rank**.
That scannable, rank-able **chart** is what's missing.

**Core principle for every chart below:** a ranked, numbered Top-N list, with a
**per-year breakdown *and* an all-time total** view. (Example the owner asked for: Deep Cuts
currently shows *one* "most played in a day" track — instead show a **Top 10 per year, then
all-time**.)

Coverage tags: **[H]** = history-only, 100% coverage. **[C]** = needs `track_features`
(catalog enrichment, ~94% coverage; show a coverage note when low, keep a `SAMPLE_*` fallback).

---

## 2. Page & interaction model

A dedicated **Charts page** (`charts.html`, navbar item after Overview / Explore).

**Shared shell for every chart:**
- **Numbered rows** — big `#1…#100`, medal color for top 3.
- **Cover / artist image** via existing `loadCover()` (oEmbed cache, `/api/image`).
- **Primary stat = minutes listened** (default; matches Wrapped) + secondary streams count.
- **Share mini-bar** — width relative to #1.
- Optional **▲▼ movement** column (rank change vs previous period).

**Shared controls (chart toolbar):**
- **Time selector** — `All-time · 2025 · 2024 · 2023 · …` (the per-year/total switch). This is
  the heart of the feature: every chart is viewable per year and as an all-time total.
- **Depth** — Top 5 / 10 / 20 / 50 / 100.
- **Sort** — Minutes (default) ⇄ Streams (where both make sense).
- **Find-your-rank search** — type a name → scroll to + highlight the row; if it's outside the
  visible depth, still report the exact number (*"SZA — #1 of your top artists"*). This directly
  recreates "go to any artist and see their rank."

**Podium** — top 3 rendered as a visual podium above the list; rows continue from #4.

**Expandable rows** — click a row to reveal a mini-profile (plays, minutes, first/last listen,
peak month, top track by that artist).

---

## 3. Chart catalog

### 3.1 Core rankings (flagship, build first) — all [H]

| Chart | Ranked by | Per-year + total | Notes |
|---|---|---|---|
| **Top Artists** | minutes / streams | yes | the headline chart |
| **Top Tracks** | minutes / streams | yes | album cover + artist per row |
| **Top Albums** | minutes / streams | yes | already time-ranked in overview |
| **Top Genres** | minutes / streams | yes | reuse `_umbrella_genre` in `metrics.py` [C] |
| **Top Decades / Eras** | minutes | yes | from `release_year` [C] |

### 3.2 Superlative charts — turn single-value "facts" into Top-10 lists

These take the one-off superlatives already scattered in Explore and make them **ranked, per-year
+ total**. This is the pattern the owner explicitly asked for.

| Chart | What each row is | Coverage | Why it's interesting |
|---|---|---|---|
| **Obsession of the Day** ✅ | track + the single day you played it most (×N) | [H] | the "Deep Cuts most-in-a-day" as a real Top 10 per year + all-time. **Built** (`/api/metrics/superlatives`, ≥30s plays only so skip-loops don't count). |
| **On Repeat** ✅ | tracks by longest run of consecutive back-to-back plays (×N "in a row") | [H] | genuine replays, not stuck-and-skipped. **Built** (same endpoint, ≥30s gate). |
| **Biggest Binges** ✅ | longest single-sitting sessions (gap > 30 min) + the artist that dominated | [H] | "the night you couldn't stop". **Built** (session clustering, ≥20-min floor, dominant artist + track cover). |
| **Most Skipped** ✅ | tracks you press next on most (`reason_end='fwdbtn'`), by skip rate (min 5 plays) | [H] | the honest "most hated" as a chart. **Built**. |
| **Never Skipped** ✅ | most-played tracks you never once skipped (min 10 plays, 0 skips) | [H] | "songs you always let ride". **Built** (history-only, not completion-based). |
| **Longest / Shortest** | longest and shortest tracks you actually played | [C] | fun extremes |

### 3.3 Time-anchored charts — all [H]

| Chart | Row = | Per-year + total | Why |
|---|---|---|---|
| **Biggest Listening Days** | a calendar day, by total minutes | yes | "your most-listened days ever" |
| **Biggest Listening Months** | a month, by total minutes | yes | seasonal peaks |
| **Song of the Month** | 12 rows/year: #1 track per month | per year | your soundtrack, month by month |
| **Artist of the Month** | 12 rows/year: #1 artist per month | per year | |
| **Song of the Summer** | #1 track for Jun–Aug each year | per year | classic Wrapped hook |
| **On This Day** | what you played exactly 1/2/3 years ago | [H] | nostalgic time capsule |

### 3.4 Discovery & loyalty charts — all [H]

| Chart | Row = | Why |
|---|---|---|
| **New This Year** | artists first heard this year, ranked by plays after | "who you fell for" |
| **One-Hit Wonders** | artists where one track ≈ all their plays | |
| **Most Loyal Artists** | highest share of your listening / longest first→last span | "your ride-or-dies" |
| **Biggest Climbers** | largest rank rise vs last year (▲ +18) | movement drama |
| **Biggest Fallers** | largest rank drop vs last year (▼ −22) | "who you moved on from" |
| **Longest Relationships** | artists spanning the most months/years | |
| **Comeback Artists** | went quiet, then returned | |

### 3.5 Behavior charts — all [H]

| Chart | Row = | Why |
|---|---|---|
| **Late-Night Artists** | most-played after midnight (local time) | "your 2 a.m. rotation" |
| **Morning / Focus / Workout** | top tracks by time-of-day bucket | context playlists |
| **Most Shuffled vs Hand-Picked** | artists you mostly shuffle into vs deliberately choose | intent split |
| **Comfort Songs** | tracks returned to across the most *different* days | breadth of habit, not raw count |
| **Guilty Pleasures** | high plays but low completion | the paradox chart |

### 3.6 Sound & mood charts — all [C]

Ranked lists over your most-played tracks, using audio features (apply the same genre energy
de-inflation the audio endpoint already uses).

| Chart | Ranked by | Why |
|---|---|---|
| **Happiest Songs** | highest valence | mood extremes |
| **Saddest Songs** | lowest valence | |
| **Most Energetic / Most Chill** | energy | |
| **Most Danceable** | danceability | |
| **Deepest Cuts** | lowest popularity, high personal plays | "songs only you know" |
| **Most Acoustic** | acousticness | |

### 3.7 Meta / comparison charts

| Chart | What it shows | Coverage |
|---|---|---|
| **Your Top 100** | one long scannable list (the "Wrapped playlist"), exportable/shareable | [H] |
| **This Year vs Last Year** | two Top-10 columns side by side + movement arrows | [H] |
| **Year-by-Year Top 5** | small Top-5 lists per year, side by side | [H] |
| **Artist Head-to-Head** | pick two artists, compare plays/minutes over time | [H] |

---

## 4. Backend design

One parameterized endpoint replaces the three `LIMIT 1` queries and powers the core rankings:

```
GET /api/metrics/chart
    ?entity=artist|track|album|genre
    &sort=minutes|streams          (default: minutes)
    &limit=100
    &range=all|<YYYY>|4w|6m        (default: all)
→ { status, entity, sort, range,
    items: [ {rank, name, artist, id, minutes, streams, share, prev_rank} ] }
```

- **Whitelist** `entity` / `sort` / `range` (reject others with 400) exactly like the bar-race
  endpoint — never interpolate user input into SQL.
- Reuse the existing GROUP BY / ORDER BY from the top-1 endpoints; drop `LIMIT 1`, add
  `ROW_NUMBER() OVER (ORDER BY …)` for `rank`, and `share` = value / max(value).
- `prev_rank` (for ▲▼) = same query for the previous period; `null` when unavailable.
- `range=<YYYY>` filters on the localized year (`ts + to_minutes(off)`, inline the offset as a
  literal — parameterizing it breaks DuckDB GROUP BY expression matching; see `metrics.py` notes).
- Superlative/behavior/time charts (§3.2–3.5) get their own small endpoints as they're built;
  each returns a ranked `items[]` in the same shape so the frontend row renderer is shared.

Frontend: one `charts.js` (or `charts/` namespace mirroring `explore/`) with a single
`renderChart(items)` row renderer reused by every chart; all fetches via
`window.fetchWithTimeout`; `esc()` names before `innerHTML`; `SAMPLE_*` fallback for [C] charts.

---

## 5. Build order

1. ~~**Core rankings** — Top Artists / Tracks / Albums numbered lists + depth + sort toggles (§3.1).~~ **Done.**
2. ~~**Find-your-rank search** (§2).~~ **Done.**
3. ~~**Per-year time selector** (`range` param).~~ **Done** (all-time + real years; 4w/6m supported by the endpoint, not yet surfaced in the UI).
4. **Superlative charts** (§3.2): ~~**Obsession of the Day**~~ + ~~**On Repeat**~~ + ~~**Biggest Binges**~~ + ~~**Most Skipped**~~ + ~~**Never Skipped**~~ (**built** — the "Superlatives" section, independent year selector), then Longest–Shortest song ([C]).
5. Podium ~~+ ▲▼ movement~~ (**done**), expandable rows, then the remaining catalog (§3.3–3.7).

Steps 1–3 are live, plus the first superlative. Next: the rest of §3.2, then §3.3.
