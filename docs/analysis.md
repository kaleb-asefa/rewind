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

> **Rank Velocity is intentionally left out for now.** The current month-over-month
> artist-rank computation needs to be reworked before it can be trusted and documented. It
> will get its own section once the improved version lands.

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

**Measures:** the album the user played the most times.

**Computation:** group non-null rows by the pair (`album_name`, `artist_name`), count rows as
`total_streams` and sum `ms_played`, order by stream count descending, take the top row. The
`album_id` is looked up from `track_features` for the cover image.

**Displayed as:** album name + artist + stream count.

**Notes and caveats:**

- Aggregates play events across all tracks on the album, so a large album has more chances to
  accumulate streams than a single — album length is a confounding factor when comparing.
- Singles are their own "album", and deluxe/compilation editions are distinct albums whenever
  their `album_name` differs, even for the same underlying songs.
- Same streams-vs-minutes ranking behavior as the other top cards.

## Known limitations (shared)

- **Streams reward frequency, not depth.** All three "top" metrics rank by play-event count.
  A time-weighted variant (rank by `total_ms`) is available from the same query fields and may
  be offered as a toggle later.
- **Name-based grouping.** Top Track and Top Album group on display names, which favors
  readability over the stricter uniqueness `track_uri` would give. Edge cases (remasters,
  re-releases, capitalization differences) are the price of that choice.
- **No skip/short-play filtering.** A future refinement could discount plays under a threshold
  (e.g. < 30s) so accidental taps don't inflate stream counts.
