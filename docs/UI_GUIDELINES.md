# Rewind — UI & Copy Rules

How we build front‑end so it stays clean, scannable, and un‑cluttered. Follow these
whenever adding or editing any page, chapter, or card. When in doubt, **cut**.

## Why (the evidence)

- Users **scan, they don't read** — 79% scan a new page, only 16% read word‑by‑word. (NN/g)
- **Fewer words = better UX.** In NN/g's study: concise copy **+58%** task success, scannable
  layout **+47%**, objective (non‑hype) wording **+27%**, all three together **+124%**.
- **Clutter is a tax.** Redundant links, needless images, and decorative typography add
  *extraneous cognitive load* and slow users down. (NN/g, "Minimize Cognitive Load")
- **Show, don't tell.** Offload text to a value, chart, icon, or smart default. (NN/g)
- **Progressive disclosure.** Lead with the few important things; defer the rest to hover /
  secondary. Whatever is on screen by default signals "this matters." (NN/g)
- **Data‑ink over chart‑junk.** Every pixel should carry information; delete decoration that
  doesn't. One clear takeaway per chart. (Tufte; "Storytelling with Data")

Exemplars to imitate: Spotify Wrapped, Stripe, Linear, Vercel Analytics, Apple — big numbers,
tiny labels, one idea per card, almost no paragraph copy.

## The laws

1. **Say it once.** Every fact/insight lives in exactly one place. Never let a caption repeat a
   card that repeats a chart axis.
2. **Halve the words.** Draft it, then cut copy ~50%. Prefer a number or visual over a sentence.
3. **Scan, don't read.** Title + value + label. No explanatory paragraphs unless truly needed.
   One idea per line.
4. **Let the visual speak.** If the chart's axis/labels already say it, delete the sentence.
5. **One card = one idea.** Don't stack multiple summaries of the same dimension in a card or
   section.
6. **Objective, not marketese.** No boastful/subjective adjectives ("captivating", "stellar",
   "every song"). State the fact.
7. **Labels are clear, not clever.** Meaningful sub‑headings; skip puns and cute lines.
8. **Defer detail to hover.** Per‑item breakdowns belong in tooltips, not on the page.
9. **Meaningful styling only.** Color, weight, and icons must encode information; no decoration
   for its own sake.
10. **Reuse patterns.** Consistent card anatomy and known layouts lower the learning cost.

## Copy budgets (hard limits)

| Element | Budget |
| --- | --- |
| Page/section subtitle | ≤ 10 words, or none |
| Card title | ≤ 4 words |
| Card helper line | ≤ 8 words, and only if it adds info the visual can't |
| Chart axis / legend label | 1–2 words |
| Tooltip | `Name` + one value line |
| Stat card | big value + ≤ 3‑word label |

If a helper line restates the title or the chart, delete it.

## Anti‑clutter checklist (run before shipping a chapter)

- [ ] Is any fact shown more than once across cards/captions/axes? Remove the duplicates.
- [ ] Does every card earn its place, or is it a reworded version of a neighbour? Cut it.
- [ ] Can a sentence become a number, gauge, or icon? Do it.
- [ ] Any subjective/hype words? Replace with plain facts.
- [ ] Does each card description add new info beyond its title + visual? If not, delete it.
- [ ] Are there ≥ 3 elements covering the same underlying metric? Keep one.
- [ ] Placeholder/fake links, dummy footer items, decorative icons with no meaning — remove.
