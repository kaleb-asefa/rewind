# Rewind — Atlas (concept)

A proposed companion page to **Explore**. Where Explore is a guided, linear narrative
that *tells* you a story chapter by chapter, **Atlas** is one living, interactive canvas
that you *drive*. It is the "mirror," not the "leaderboard" — the anti‑Wrapped.

One line: **"Every day you listened, coloured by how it sounded — scrub your life through
your music."**

A working visual preview lives at `atlas_sample.html` (self‑contained, sample data).

---

## Why this page exists (the point)

Wrapped tells you *what* you played (top artists / songs / minutes) — vanity metrics
optimised for a shareable slide. The real value of listening data is *why / how / so what*:
music as an emotional and behavioural fingerprint of your life. Atlas is built to surface
that — honestly, year‑round, and exploratory — the things Wrapped avoids because depth and
honesty don't go viral.

- **Explore** = a story it tells you (scroll, read).
- **Atlas** = a mirror you wander through (drive, ask, reflect).
- **Wrapped** = a badge you post once a year (flatter, share).

---

## The hero: a mood‑coloured life canvas

A calendar‑river of your whole history — the GitHub‑style heatmap, but **emotional** rather
than just volume:

- **Colour = mood.** Hue from valence (blue = melancholic → green = content → amber =
  euphoric); brightness/saturation from (genre‑corrected) energy. A chill‑sad week reads
  deep blue‑dim; a hype summer reads bright gold. Green anchors the middle, so the brand
  colour still reads as "balanced."
- **Opacity = volume** (minutes that day) — emotion and intensity are both visible at a
  glance.
- **Eras auto‑label.** Changepoint detection over the daily mood/genre series draws soft
  bands: *"Winter blues · Jan–Feb," "Golden summer · Jun–Aug."* This is the piece that makes
  people go "oh" — the emotional fingerprint of your years, earned from the data, not an
  assigned persona.

This is the **most interesting** element and the centrepiece of the sample page.

---

## Interactions (where the depth lives)

- **Scrub / zoom** years → months → a single day. Zooming into a day shows that session:
  songs in order, the energy arc, where you skipped.
- **Click a day** → a panel: what you played, the standout track, how the day *felt* (mood
  word), context (device, morning/night, shuffle vs. hand‑picked).
- **On this day** — jump to what you played exactly 1/2/3 years ago. Memory, not vanity.
- **Filter lens** — repaint the whole canvas by mood, genre, or time of day: *"show me only
  my late‑night sad songs."* The query‑driven playground Wrapped never allows.

---

## Supporting panels

1. **Emotional arc** — one line of average positivity across your whole history: drifting
   happier or darker? (extends Chapter 9's mood drift to the full life view).
2. **Rediscover** (agency) — tracks you once looped daily and haven't played in 6+ months,
   with a "play again" nudge. The "help me break the rut" value.
3. **Your modes** — sessions clustered into commute / focus / party / wind‑down, and when
   each happens. The behavioural mirror.
4. **Weather of the week** — the emotional soundtrack collapsed to a 7‑day rhythm: Monday
   anxious, Friday euphoric, Sunday‑night blues.

---

## Why it catches eyes (and stays honest)

- One striking, colourful, deeply personal canvas — instantly screenshot‑worthy, but what's
  shared is a truthful emotional map, not a flattering badge.
- No two Atlases look alike (colour is driven by *your* moods), so it has Wrapped's
  shareability without Wrapped's dishonesty.
- It's a page you'd reopen in March, not just once a year.

---

## Data & feasibility

Roughly ~80% reuses what already exists:

- **Mood colouring** = valence + genre‑corrected energy per day → both already computed
  (Chapters 3/9).
- **Calendar mechanics** = the Overview heatmap already handles the grid + local‑date logic.
- **Eras** = changepoint detection on the daily mood/genre series → one new endpoint.
- **Rediscover / on‑this‑day / modes** = pure `history` [H], patterns we already have.

New work: the mood‑canvas renderer + a changepoint/era endpoint + a per‑day detail endpoint.

**Colour caveat:** the canvas intentionally uses full mood colour (a *data encoding*, which
the design system permits) instead of green‑only. The rest of the page stays in the dark +
Spotify‑green system.

---

## Lighter alternatives (if Atlas is too big)

- **Moments** — a small page focused only on *agency*: rediscover forgotten loves, "on this
  day," never‑skips, songs tied to specific weeks. Cheaper, honest, less flashy.
- **Fingerprint** — a single generative art piece (a constellation/aura from your
  audio‑feature distribution). Maximum catch‑eyes, minimum depth.

---

## Build plan (when green‑lit)

1. Standalone `atlas.html` + `src/js/atlas/*` (own namespace, same defer pattern as Explore).
2. Endpoints: `GET /api/metrics/atlas-days` (per‑day mood/volume/standouts),
   `GET /api/metrics/eras` (changepoint bands), reuse heatmap for the grid.
3. Panels wired one at a time with SAMPLE fallback, like every Explore chapter.
