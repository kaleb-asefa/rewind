# Rewind — Analysis

## Purpose

This document explains the **analysis** behind the Overview dashboard: what each metric
actually measures, how it is derived from the raw `history` table, and the decisions and
caveats that shape the number a user sees. It is the reasoning layer that sits between the
schema ([`SCHEMA.md`](SCHEMA.md)) and the endpoints ([`BACKEND.md`](BACKEND.md)).

It starts small and grows as more analysis is added. This first pass covers only the four
headline metric cards.

### Documented so far

1. Total Listening Time
2. Top Artist
3. Top Track
4. Top Album

> **Rank Velocity is being reworked, not removed.** The old month-over-month artist-rank
> jittered too hard — artists dropped to zero and new ones jumped in every frame. The chosen
> smoothing approach is now specified under [Animated visualizations](#animated-visualizations)
> below. It is a decided design, not yet implemented in the endpoint.

## Foundational concepts

A few definitions are used throughout the metrics below:

- **Stream (play event)** — one row in `history`. Spotify records a row every time a track
  *starts* playing, regardless of how long it was heard. A 3-second skip and a full 4-minute
  listen each count as exactly one stream.
- **`ms_played`** — the real milliseconds a row was heard. This is the honest "time" measure;
  unlike a stream count, it is not inflated by skips or repeated partial plays.
- **Music vs. podcast** — music rows carry `track_name` / `artist_name` / `album_name`;
  podcast rows leave those `NULL` and fill `episode_name` / `episode_show_name` instead. The
  three "top" metrics filter out `NULL` names, so they are **music-only** by construction.
  Total Listening Time applies no such filter and therefore currently includes podcasts.
- **Ranking by streams vs. by time** — the three "top" cards rank by **stream count**, not by
  minutes. This rewards what is played *often* (many short repeats) over what is played *long*
  (a few complete listens). Each card still surfaces total minutes as a secondary figure, so
  the two views are available side by side.
- **Live computation** — every metric is recomputed from `history` on each request
  (`run_in_threadpool`). Nothing is cached or pre-aggregated, so numbers always reflect the
  latest upload.

## 1. Total Listening Time

**Endpoint:** `GET /api/metrics/total-time`

**Measures:** the total wall-clock time of audio played, across the entire history.

**Computation:** `SUM(ms_played)` over every row (coalesced to `0` when the table is empty),
converted to minutes (`ms / 60000`) and rounded to two decimals. The frontend card then lets
the user click to cycle the unit: **minutes → hours → days**.

**Notes and caveats:**

- Counts *every* row — music and podcast, skipped and completed alike. It is "time audio was
  playing", not "time spent finishing songs".
- No minimum-duration threshold and no de-duplication: a track replayed ten times contributes
  all ten play durations.
- Because podcasts are included here but excluded from the top-N cards, Total Time can exceed
  the sum of per-artist minutes.

## 2. Top Artist

**Endpoint:** `GET /api/metrics/top-artist`

**Measures:** the artist the user played the most times.

**Computation:** group non-null rows by `artist_name`, count rows as `total_streams` and sum
`ms_played` as `total_ms`, order by stream count descending, and take the top row. The
matching `artist_id` is looked up from the enriched `track_features` slice so the card can
lazy-load a cover image.

**Displayed as:** artist name + "N total streams" (with `total_minutes` also returned).

**Notes and caveats:**

- Ranked by **streams**, so an artist with many short plays can outrank one with fewer but
  longer listens. `total_minutes` is provided to make that tradeoff visible.
- `artist_name` is Spotify's *album-artist* field, so featured/guest appearances are credited
  to the primary album artist, not the feature.
- Ties are resolved arbitrarily by the database — acceptable at the top-1 granularity, but
  worth revisiting if this ever becomes a ranked list.

## 3. Top Track

**Endpoint:** `GET /api/metrics/top-track`

**Measures:** the single track the user played the most times.

**Computation:** group non-null rows by the pair (`track_name`, `artist_name`), count rows as
`total_streams` and sum `ms_played`, order by stream count descending, take the top row. The
`track_id` is derived directly from `track_uri` (always present on music rows), so its cover
loads without waiting on catalog enrichment.

**Displayed as:** track name + "by {artist} • N streams".

**Notes and caveats:**

- Grouped by **name + artist**, not by `track_uri`. Pairing the title with the artist keeps
  the result human-readable and prevents two different songs that share a title from being
  merged. The tradeoff: a remaster or re-release with a slightly different name (or the same
  song on two albums) can split into separate entries, where a `track_uri`-based grouping
  would behave differently. This is a deliberate readability choice, noted here so it can be
  reconsidered later.
- Same streams-vs-minutes ranking behavior as Top Artist.

## 4. Top Album

**Endpoint:** `GET /api/metrics/top-album`

**Measures:** the album the user spent the most *time* listening to.

**Computation:** group non-null rows by the pair (`album_name`, `artist_name`), sum
`ms_played` and count rows, order by **total listening time** descending, take the top row.
The `album_id` is looked up from `track_features` for the cover image.

**Displayed as:** album name + artist + total listening time (hours).

**Notes and caveats:**

- **Ranked by time, not streams** (unlike Top Artist / Top Track). Time is the more honest
  "which record did I actually live in" measure, and it makes the album card agree with the
  all-time bar race, whose #1 album is also time-ranked.
- Aggregates listening across all tracks on the album, so a long album has more room to
  accumulate time than a single — album length is still a confounding factor when comparing.
- Singles are their own "album", and deluxe/compilation editions are distinct albums whenever
  their `album_name` differs, even for the same underlying songs.

## Known limitations (shared)

- **Streams vs. time.** Top Artist and Top Track rank by play count (frequency); Top Album
  ranks by listening time (depth). Every endpoint returns both figures, so any card could
  expose a toggle later.
- **Name-based grouping.** Top Track and Top Album group on display names, which favors
  readability over the stricter uniqueness `track_uri` would give. Edge cases (remasters,
  re-releases, capitalization differences) are the price of that choice.
- **No skip/short-play filtering.** A future refinement could discount plays under a threshold
  (e.g. < 30s) so accidental taps don't inflate stream counts.

## Analysis backlog

The Overview cards above are the foundation. This section is the **catalog of analyses we
want to build** on top of the same data — a reviewed backlog, not a commitment to order.
Items are tagged by what they need:

- **[H]** — pure `history` table (available today).
- **[C]** — needs the catalog slice (`track_features`): audio features, genres, popularity,
  release year, duration, explicit. Covers ~94% of tracks; the obscure ~6% stay unmatched.
- **[D]** — derived/composite score built from the above.

### What the data makes possible

Two data sources drive everything:

- **`history`** — every play event with timestamp, `ms_played`, platform, `conn_country`,
  track/artist/album names + `track_uri`, and behavior flags (`shuffle`, `skipped`,
  `reason_start`, `reason_end`, `offline`, `incognito_mode`).
- **`track_features`** (catalog enrichment) — per track: full **audio features**
  (danceability, energy, valence, tempo, key, mode, acousticness, instrumentalness,
  loudness, speechiness, liveness, time_signature), plus **popularity**,
  **artist_popularity**, **artist_genres**, **release_year**, **duration**, **isrc**,
  **explicit**. The audio features are the key unlock — they exist locally even though
  Spotify's audio-features API is deprecated.

### A. Time, rhythm & consistency [H]

1. **Listening clock** — 24-hour radial of when you listen; peak hour.
2. **Weekday vs weekend** patterns and per-weekday totals.
3. **Seasonal / month-of-year** curve across the full history.
4. **Night-owl vs early-bird** score + "3 AM artists" (what plays late night).
5. **Longest daily streak** (consecutive days with a play), current streak, active days.
6. **Biggest day / week / month** ever, with what was played.
7. **Listening sessions** — cluster plays by gaps; avg session length, longest binge.
8. **Time-of-day mood shift** — mornings vs nights (pairs with audio features).
9. **Hours-per-day trend** — listening more or less over time.

### B. Behavior & engagement [H]

10. **Skip rate** overall and **most-skipped tracks/artists** ("most hated").
11. **Completion rate** — % of each track heard (`ms_played` ÷ track `duration`, needs [C]).
12. **Skip rate by time of day / weekday / platform** — when you're restless.
13. **Replay behavior** — back-to-back repeats (`backbtn`), most-looped in one sitting.
14. **Deliberate vs passive** — `clickrow`/`playbtn` vs `trackdone`/shuffle.
15. **Shuffle dependence** — shuffle vs hand-picked listening split.
16. **How songs start and end** — Sankey of `reason_start` → `reason_end`.
17. **Attention span** — distribution of play durations; under-30s sampling rate.
18. **Offline listening** — what/when you play offline.

### C. Top-N, discovery & loyalty [H]

19. **Top artists / tracks / albums** for any window (all-time, per year, per month).
20. **Per-year "Wrapped"** — each year its own top lists + song of the year.
21. **Discovery rate** — new artists/tracks first heard per month.
22. **One-hit wonders** — artists played exactly once vs ride-or-dies.
23. **Rediscovery** — songs that vanished then came back; longest gap between plays.
24. **Loyalty concentration** — % of listening from top 10 artists (Gini / diversity index).
25. **Album commitment** — full albums vs cherry-picked singles.
26. **Song of the summer** — top track per season each year.
27. **First & last play** of every artist — who's fading, who's rising (retention).

### D. Audio DNA & mood [C]

28. **Mood quadrant** — valence × energy map (Happy / Angry / Sad / Chill).
29. **Mood over time** — taste getting happier/sadder month to month.
30. **Average audio profile** — danceability/energy/valence/acousticness radar.
31. **Tempo (BPM) distribution** — average BPM, workout-tempo tracks, slow jams.
32. **Danceability leaders** and most/least danceable periods.
33. **Acoustic vs electronic** balance; **instrumental** listening share.
34. **Key & mode** — major (happy) vs minor (sad) split; common key; Camelot wheel.
35. **Explicit content %** over time.
36. **Energy by time of day** — calm mornings vs hype nights (joins A + D).

### E. Genre & taste [C]

37. **Genre breakdown** — top genres by plays and by hours (via `artist_genres`).
38. **Genre evolution** — stacked area of genre share over time.
39. **Taste diversity** — distinct genres, concentration vs breadth.
40. **Genre by mood/time** — which genres you reach for late at night.

### F. Popularity & obscurity [C]

41. **Mainstream vs underground score** — avg track `popularity` vs global.
42. **Hipster gems** — most-played low-popularity tracks (you were early).
43. **Basic-ness index** — share of listening that's chart-topping.
44. **Artist popularity spread** — megastars vs small artists.

### G. Era / release year [C]

45. **Decade breakdown** — listening by release decade.
46. **New vs catalog** — fresh releases vs older music; average "music age".
47. **Music time machine** — oldest and newest tracks played.
48. **Nostalgia index** — drifting toward older or newer music over time.

### H. Geography & devices [H]

49. **Travel map** — listening by `conn_country`; timeline of where you listened from.
50. **Soundtrack of each place** — top track/artist per country.
51. **Device story** — per-platform listening differences.
52. **Platform over time** — when you switched devices.

### I. Superlatives & fun (Wrapped-style) [H/C]

53. **Listening personality** [D] — badges: Explorer↔Loyalist, Mainstream↔Underground,
    Night-Owl↔Early-Bird, Focused↔Restless (skip), Shuffler↔Curator.
54. **Longest / shortest song** played; most-repeated song in a single day.
55. **The song you couldn't skip** (0% skip, many plays) vs the one you always skip.
56. **Milestones** — your 1,000th / 10,000th play and what it was.
57. **"On this day"** — what you were playing a year ago.

### Cross-cutting caveats

- **Home country dominates** `conn_country`; other countries are real travel/VPN but sparse —
  good for a map, but don't over-read small counts.
- **Popularity is a 0–1 snapshot**, not historical — "mainstream score" is approximate.
- **Define "skip" consistently** — flag vs `< 30s` vs `fwdbtn`; pick one and note it.
- **Audio-feature coverage ~94%** — always surface the coverage figure alongside [C] metrics.

## Animated visualizations

Two time-based animations live here. They answer different questions and, importantly, have
different motion characteristics — one needs deliberate smoothing, the other is smooth by
construction.

### Rank Velocity — smoothing approach (chosen)

**Question:** which artists (or tracks) were *trending* at each point in time — including the
ones you binged for a few months and then abandoned?

**Problem with the naive version:** rank was computed from a single calendar month's plays.
Sparse months swung wildly and lines snapped between the top and the floor every frame — pure
jitter, not a readable trend.

**The tension:** a *fixed* all-time Top-N is perfectly stable but a poor insight — it can only
ever show your all-time leaders, never the artist you obsessed over for three months and then
dropped. The chart *must* let entities **enter and leave** to tell that story; the job of the
maths is to make those entrances and exits smooth and meaningful rather than jittery.

**Chosen method:**

1. **EWMA score (smooths the signal).** Score each entity by an exponentially weighted moving
   average of monthly listening time:

   $$S_t = \alpha \cdot m_t + (1-\alpha)\,S_{t-1}$$

   where $m_t$ is minutes listened in month $t$ and $\alpha \approx 0.35$ (lower = smoother,
   higher = more responsive). Fading memory means a few heavy months build a peak that then
   *decays* once you stop — so an obsession rises smoothly and later **flops** off-chart
   instead of vanishing in a single frame.

2. **Per-month Top-N (genuine enter/leave).** Each month keeps the top $N$ by that smoothed
   score; everyone else is off-chart (rank $N+1$). An entity appears only **after its first
   listen** ($S_t > 0$) and drops off when others out-score it — capturing rise and fall.

3. **Relegation hysteresis (stops boundary flicker).** A newcomer only displaces the incumbent
   in the last slot if it clears them by a small margin, so lines don't blink in and out for a
   single month at the edge.

**Defaults:** $\alpha = 0.35$, $N = 8$, monthly frames, relegation margin $\approx 0.1$. All
tunable. Works for artists and tracks; the frontend interpolates between monthly ranks so the
lines glide.

### All-time bar race (new)

**Question:** how did cumulative listening pile up over time, and who ends up on top?

**Idea:** a horizontal **bar-chart race**. The timeline plays forward from the first play to
the last; each artist's (or track's, or album's) bar grows as its *cumulative* listening time
accumulates, and bars re-sort as leaders overtake each other. At the final frame the bars
equal the all-time totals. Because the race ranks by **time**, its final #1 matches the
**Top Album** card exactly (also time-ranked); the Top Artist / Top Track cards rank by
streams, so their #1 can differ from the race's time-based leader.

**Metric:** cumulative **time spent listening** (running sum of `ms_played`, shown as
minutes/hours), grouped by the chosen entity. A stream-count variant is possible but time is
the more honest "who did I actually spend my life on" measure.

**Why it's smooth:** the value is cumulative, so bars only ever **grow, never shrink** — no
month-to-month collapse and no score-smoothing maths needed. Growth is continuous (values are
interpolated between monthly keyframes each animation frame) and the vertical re-ordering is
**eased** (each row glides toward its new slot instead of snapping), giving the fluid
overtaking motion of a classic bar-chart race. This is the key contrast with Rank Velocity
above, whose per-period value can fall and therefore needs EWMA + hysteresis.

**Style:** a single monochrome **green** ramp (theme colour) — brighter at the top, deeper
toward the bottom — rather than one colour per entity.

**Shape of the data:** for each time step (monthly or weekly frame), compute the running
`SUM(ms_played)` per entity up to that step and keep the top N for the frame. Toggle entity
(artist / track / album). The final frame is just the all-time top-N leaderboard.

**Caveats:** entities that peak early then go quiet still keep their bar length (cumulative
never drops) — that's correct for "all-time", but it means the race shows *accumulated* love,
not *current* momentum. Rank Velocity is the companion view for momentum.
