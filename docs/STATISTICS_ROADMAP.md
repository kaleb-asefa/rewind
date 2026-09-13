# Rewind — Applied Statistics Roadmap

**Status:** Brainstorming; these are candidate investigations, not implemented features.
**Date:** 2026-09-13

## Goal

Use Rewind to develop substantive statistical skills and produce an interview-ready
case study—not simply add more charts or attach advanced methods to existing metrics.

The guiding principle is: **ask a useful question, build a defensible model, and
demonstrate when it works—or fails.** One thoroughly evaluated investigation is more
valuable than ten loosely justified models.

## Why this dataset is suitable

Listening history contains repeated observations, time dependence, noisy behavioral
signals, unequal exposure, and missing catalog metadata. These are real statistical
problems, not just visualization opportunities.

The existing contextual-rejection notebook already explores matched baselines,
session/day aggregation, multiple-testing adjustments, and bootstrap ranking
stability. That is a useful starting point, but aggregation alone does not establish
independence, and applying a correction does not guarantee that the underlying
inference is calibrated.

## 1. Persistent rejection versus a bad listening session

**Question:** Is a track repeatedly rejected, or does it merely appear when the
listener is already skipping everything?

**Direction:** Extend the current work with a hierarchical logistic model containing:

- Track and artist effects.
- Session-level variation, shared across tracks heard in the same sitting.
- Context such as start mechanism, shuffle, and prior familiarity.
- Partial pooling so rarely heard tracks do not receive extreme estimates from
  just two observations.

Define the outcome and eligible exposure population explicitly. If ambiguous
partial plays are excluded, the estimated rejection probability applies to that
selected population—not automatically to all plays.

**Product application:** Report evidence of unusually high rejection with
uncertainty. Return a shortlist or withhold a verdict when the leading tracks
cannot be reliably distinguished. Avoid presenting a rank as proof of emotion.

**Skills:** Multilevel modeling, shrinkage, variance decomposition, posterior
predictive checks, and uncertain rankings.

**Validation:**

- Compare against raw skip rates and a context-only baseline on later periods.
- Assess probability calibration and log loss, not only classification accuracy.
- For unseen sessions, do not estimate their effects using held-out outcomes.
- Simulate known track effects to test ranking recovery and interval coverage.
- Check sensitivity to priors, rejection definitions, and session boundaries.

**Interview connection:** Customer-level risk estimates, provider comparisons,
and other settings where small samples create misleading leaderboards.

**Main limitation:** Successfully predicting rapid skips does not validate the
psychological label “hate.”

## 2. Which discoveries become lasting favorites?

**Question:** After an artist first appears in the export, how likely is the
listener to deliberately return within 30 days?

**Direction:** Treat this as a survival-analysis and retention problem:

- Define the event as a subsequent deliberate listen.
- Measure time from the first observed encounter.
- Treat artists encountered near the export's end as right-censored, not failures.
- Compare a simple survival baseline with a regression model using information
  available at the initial encounter.
- Later distinguish “returned once” from “became a regular,” with a separate,
  explicit definition for sustained loyalty.

**Product application:** Discovery-to-loyalty trajectories rather than just
counts of new artists.

**Skills:** Censoring, survival functions, hazard models, cohort analysis, and
eventually time-varying predictors.

**Validation:** Evaluate on later discovery cohorts using censoring-aware
calibration and prediction scores. Check whether conclusions change under
different return windows and deliberate-listen definitions.

**Interview connection:** Customer retention, repeat purchases, and product adoption.

**Main limitations:** First observed does not necessarily mean genuinely new.
Not returning may reflect lack of opportunity rather than dislike. The export
boundary and any missing periods must be audited before defining follow-up.

## 3. Are the listener's musical “eras” real?

**Question:** When did the listening distribution actually change, beyond
ordinary week-to-week noise?

**Direction:** Apply change-point detection to artist or genre shares. Account
for listening volume: a week with ten plays should not carry the same evidence
as one with hundreds. Shares are compositional—they sum to one—so do not treat
each genre's share as an unrelated series.

Start with a simple penalized segmentation model before considering more
elaborate state-space models.

**Product application:** Identify sustained changes in listening with approximate
transition windows, rather than declaring a new “era” every time the monthly
top artist changes.

**Skills:** Time-series dependence, likelihood-based segmentation, regularization,
compositional data, and uncertainty in change detection.

**Validation:**

- Simulate histories with known changes and histories with no changes.
- Measure false alarms and change-location error.
- If building an online detector, also measure detection delay without using
  observations from the future.
- Test sensitivity to weekly versus monthly aggregation, minimum segment length,
  listening volume, and missing periods.

**Interview connection:** Changes in customer behavior, demand, operational
processes, and fraud patterns.

**Main limitation:** A musical shift does not establish a breakup, emotional
state, or other life event. Those causes are not observed in the export.

## 4. Does repetition build affection—or fatigue?

**Question:** For the same track, how does recent exposure relate to the
probability of rejecting its next play?

**Direction:** Build a longitudinal model, potentially a generalized additive
mixed model, using:

- Prior plays over recent days.
- Time since the previous listen.
- Track effects and listening context.
- Nonlinear relationships: repetition might initially accompany increasing
  engagement, then become associated with fatigue.

All exposure features must use past information only.

**Product application:** Describe how engagement varies with repetition and
spacing. Do not recommend a supposedly optimal replay frequency without evidence
that changing spacing improves outcomes.

**Skills:** Longitudinal modeling, nonlinear effects, temporal feature engineering,
confounding, and experimental design.

**Validation:** Compare against a model without repetition features using
future-period evaluation. Check whether patterns persist within tracks, across
time windows, and after accounting for observable context.

**Causal extension:** A prospective randomized playlist-spacing experiment could
test the effect of spacing. It would require new assignment logs, a prespecified
outcome, a feasible randomization unit, and attention to carryover between sessions.
The historical export alone is not a randomized experiment.

**Interview connection:** Advertising fatigue, notification frequency,
recommendation systems, and experimentation.

**Main limitation:** Favorite tracks are played more often. An association between
repetition and engagement does not establish that repetition caused enjoyment.

## What makes an investigation interview-ready?

1. **Explicit target:** State what is being estimated, for whom, over what period,
   and from which eligible observations.
2. **Simple baseline:** Demonstrate whether added complexity earns its place.
3. **Realistic validation:** Use future-period evaluation for prediction and
   simulation to evaluate inferential properties such as coverage and false alarms.
4. **Failure analysis:** Examine dependence, sparse tracks, missing metadata,
   export gaps, and sensitivity to modeling definitions.
5. **Usable decision:** Explain what the result enables, including when
   “insufficient evidence” is the correct output.
6. **Reproducibility:** Preserve the data definitions, model configuration,
   validation split, and a clear record of exploratory versus confirmatory work.

Thousands of plays from one person are **not thousands of independent people**.
A strong single-listener study is valid as such. Population claims require
additional users, appropriate sampling, and user-level validation.

The final case study should explain the question, assumptions, baseline,
evaluation, actual findings, limitations, and product decision. Do not claim
improvements or causal effects before measuring them.

## Recommended starting point

| Priority | Direction | Reason |
| --- | --- | --- |
| Extend existing work | Hierarchical rejection | Strongest upgrade to the current notebook; develops uncertainty-aware modeling. |
| Build a fresh feature | Discovery-to-loyalty survival analysis | Clear retention question with a direct business connection. |
| Combine inference and storytelling | Musical-era detection | A visible product feature with testable statistical behavior. |
| Explore longitudinal and causal reasoning | Repetition and fatigue | Rich observational problem with a possible future experiment. |

Choose one investigation first. Define its target and baseline before choosing
the most sophisticated model. No new feature, dependency, or experiment is
committed to by this roadmap.

### Questions for the next brainstorming session

- Which question is most interesting: rejection, loyalty, taste changes, or fatigue?
- Which skills should the project emphasize: Bayesian inference, survival analysis,
  time series, or experimental design?
- Is the first goal a single-listener case study or a method evaluated across users?
- What result would make the feature useful—and what result would justify not shipping it?