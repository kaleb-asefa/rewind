# Rewind — Analysis Ideas (Future)

Candidate analyses to add on top of what's already built (Overview + the 11 Explore
chapters + the Wrapped finale). Ordered by how much genuine insight each brings versus
being "just another card." Nothing here is implemented yet.

Two data sources drive everything:
- **`history`** — every play: timestamp, `ms_played`, platform, `conn_country`,
  track/artist/album + `track_uri`, and behaviour flags (`shuffle`, `skipped`,
  `reason_start`, `reason_end`, `offline`, `incognito_mode`).
- **`track_features`** (catalog enrichment, ~94% coverage) — per track: audio features
  (danceability, energy, valence, tempo, key, mode, acousticness, instrumentalness,
  loudness, speechiness, liveness), plus popularity, artist_popularity, artist_genres,
  release_year, duration, isrc, explicit.

---

## 1. Finish the half-built one: Most Hated

The Overview still shows hardcoded placeholders (`Nickelback` / `Baby Shark`) for
"Most hated artist / track." A defensible method is already designed and validated in
`notebooks/main.ipynb` (Method E — "Forced & Rejected"):

- Skip **intent** matters: skipping a hand-picked song ≠ hate; skipping a *served /
  autoplay* song and bailing before ~30s = real rejection.
- `reason_start` separates chosen (`clickrow`/`playbtn`) from served (`trackdone`/shuffle).
- An **artist-affinity shield** (`affinity = 1 - exp(-chosen_starts / TAU)`) stops a
  genuine favourite from leaking into the hated list.
- Validated result: #1 = "Grey" / Yung Filly (93% rejection, never chosen).

**Effort:** low — it's designed; it needs one endpoint (`/api/metrics/most-hated`) and to
replace the two placeholder cards. This is the single most obvious gap.

---

## 2. Genuinely new analyses (surface what nobody else shows)

These exploit `reason_start`/`reason_end`, `ms_played` vs catalog `duration`, and session
structure — i.e. they go beyond counts and averages.

### Listening modes (session clustering)
Cluster listening sessions into behaviours: **commute** (short mobile bursts ~8am),
**focus** (long, low-skip, low-shuffle runs), **party / hype** (high-energy, high-shuffle,
late night). Inputs already available: platform, session gaps, energy, shuffle, time of day.
High novelty; rarely done well elsewhere.

### Session energy arc
Within a session, do you **ramp up** or **wind down**? Plot average energy vs.
position-in-session. A simple, novel shape that says something true about how you use music.

### Where you bail (skip-point analysis)
From `ms_played / duration`: "you abandon at ~0:40 on average," plus your real completion
curve. Turns the blunt `skipped` flag into a precise, honest behaviour signal.

### Your eras (changepoint detection)
Run changepoint detection on the genre-mix / mood time series to auto-label phases:
"Your SZA era: Aug 2023 – Feb 2024." Reframes Chapter 9's trends as named chapters of your
listening life. Wrapped-worthy but actually earned from the data.

### Gateway tracks
The song that pulled you *into* an artist — the first play right before a binge. A discovery
story that complements Chapter 6 (Discovery & Loyalty).

---

## 3. Rigor improvements (not cards — trust)

### Confidence for small-N rankings
"Most hated," "hidden gems," and rising artists are point estimates that mislead on few
plays. The notebook already has Wilson / Beta-Binomial machinery — surface a conservative
lower bound so a 2-play track can't top a chart.

### Global year selector
Almost everything is all-time. A per-year toggle would give ~4 "Wrappeds" for free from the
endpoints that already bucket by year.

### One source of truth per axis
The Loyalist↔Explorer mismatch (Chapter 6 vs. the Finale computed the same axis from two
different metrics) is the symptom. A small shared "traits" definition (metric + thresholds +
poles) that both chapters read from prevents that whole class of bug.

---

## If only three get built
1. **Most Hated** — finish the half-built feature.
2. **Listening modes** — highest novelty per effort.
3. **Confidence intervals** — biggest quality-per-effort for trustworthy rankings.
