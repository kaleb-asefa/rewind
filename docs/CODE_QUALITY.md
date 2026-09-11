# Rewind — Code Quality & Engineering Guidelines

> Companion to [UI_GUIDELINES.md](UI_GUIDELINES.md) (UI copy & visual rules). This file
> covers **code**: how we keep the backend and frontend clean, modular, and safe as the
> app grows. New code — human- or agent-written — should follow these rules.
>
> Grounded in widely-used sources (paraphrased, not copied):
> Google Engineering Practices — *What to look for in a code review*; Martin Fowler —
> *Code Smell* / *Refactoring*; *The Twelve-Factor App*; *FastAPI Best Practices*
> (zhanymkanov); PEP 20 — *The Zen of Python*. Links in §8.

---

## 1. Principles (the "why")

1. **Readability first.** Code is read far more than it's written. *Simple > complex,
   flat > nested, explicit > implicit, readability counts* (PEP 20).
2. **Small, single-purpose units.** A function or file that does one thing is easy to test,
   reuse, and delete. A "long method" is a classic smell (Fowler) — sniffable at a glance.
3. **DRY — don't repeat yourself.** Three near-identical blocks = extract one shared thing
   (a function, a factory, a module). The whole 2026-09 modularity pass was this rule
   applied (3 duplicate card scripts → `top_card.js`; monolith `main.py` → routers + `metrics.py`).
4. **Don't over-engineer.** Solve the problem you have now, not one you speculate about
   (Google). No abstractions, options, or "flexibility" for a single caller.
5. **Fail loudly at boundaries, degrade deliberately in features.** Errors shouldn't pass
   silently (PEP 20) — *except* our metric endpoints, which intentionally return empty/zero
   (backend) or fall back to `SAMPLE_*` (frontend) when data is missing. That exception is a
   documented product choice, not accidental swallowing; keep it explicit and narrow.
6. **Comments explain _why_, not _what_.** The code shows what; a comment earns its place
   only by explaining a reason, a trade-off, or a non-obvious workaround (Google).
7. **Config in the environment, not in code** (12-Factor III). No hostnames, secrets, or
   deploy-specific values baked into source.
8. **Green tests are the contract.** Every behavior change ships with a test; never merge
   with failing tests or new errors.

---

## 2. Backend rules (FastAPI + DuckDB)

- **Keep `main.py` thin.** It only builds the app, adds middleware, and `include_router`s.
  No endpoints or business logic there.
- **One router per domain** in `backend/routers/` (`upload`, `overview`, `explore`). Endpoints
  live in their domain router.
- **Pure computation is framework-free** and lives in `backend/metrics.py` (ranking, bar-race,
  heatmap levels, streaks, chronotype, timezone, genre buckets). No FastAPI imports there — so
  it stays unit-testable in isolation.
- **Never block the event loop.** All DuckDB / file / network work runs inside
  `run_in_threadpool(...)` within an `async` route (DuckDB's driver is sync).
- **SQL-first.** Let DuckDB do the aggregation and joins; Python only shapes the result.
- **Join on identity, never on names.** Ids (`track_id`, `album_id`, `artist_id`) are exact;
  names produced by two different sources are not — the export and the catalog disagree over
  edition suffixes, casing and diacritics, and a name join fails *silently* (a `NULL` id, no
  error). Where a name must be the grouping key anyway (the artist chart), canonicalize it
  (`strip_accents(upper(trim(…)))`) and pick the display spelling with `arg_max(name, plays)`.
  See `backend/covers.py` and `_canonical_artist_rows`.
- **Never interpolate user input into SQL.** Use parameters (`?`), or — when a value must appear
  identically in `SELECT`/`GROUP BY` (a DuckDB constraint) — an **internally-validated** literal
  (e.g. a timezone offset resolved from a whitelist). Whitelist enum-like params (see the
  `bar-race` `entity` guard → `400`).
- **Preserve the test contract.** Tests monkeypatch `database.SESSIONS_DIR`, send the
  `X-Rewind-Session` ticket header, and reach `main._enrich_session` / `main._WEEKDAY_NAMES`.
  If you move those, **re-export them from `main.py`** or the suite breaks.
- **Run checks before done:** `cd backend && uv run python -m py_compile <changed>.py && uv run pytest -q`.

---

## 3. Frontend rules (vanilla, served over `file://`)

- **No build step, no ES modules.** The app is opened via `file://`, which blocks
  `<script type="module">` (CORS). Share code through an ordered set of `<script defer>` files
  plus a single `window.*` namespace (see `window.RewindExplore` and its chapter registry).
  Load order matters: the namespace/core file must come first.
- **One component = one file.** If two components are ~identical, write **one factory** and
  drive the differences with config (see `initTopCard` in `top_card.js`).
- **All API calls go through `window.fetchWithTimeout`** (from `api.js`). Do **not** hardcode
  `http://127.0.0.1:8000` in feature files or re-inline a fallback fetcher (see §6 — this is
  the current biggest debt: the host is duplicated across 8 files).
- **Escape data-derived strings before `innerHTML`** with `esc()` (XSS). Track/artist/genre
  names come from user uploads — treat them as untrusted.
- **Guard by element existence** (`const el = ...; if (!el) return;`) so a shared script safely
  no-ops on pages that don't have that DOM.
- **Colours come from tokens.** Use Tailwind's token utilities or `var(--token)` /
  `rgb(var(--accent-rgb))` in SVG/canvas renderers — never a hex or `rgb(30,215,96)` literal,
  which silently breaks the light theme. New token → add it to **both** `:root` and `.dark`
  in `main.css`. Tailwind config is shared (`src/js/tailwind_config.js`), not per page.
- **Never fake data on a real page.** Fetch, and on empty/offline render the honest empty
  state (`chapterEmpty`, `#chart-empty`, the superlatives/share empty cards). `SAMPLE_*`
  constants may only render when `window.REWIND_ALLOW_SAMPLE` is set — which only the
  `explore_bento_sample.html` mockup does.

---

## 4. Naming, comments & size

- **Names:** long enough to be unambiguous, short enough to read (Google). Prefer intent
  (`_smoothed_rank_frames`) over mechanics (`process_data2`).
- **Comments:** one line stating a *reason* the code can't show (e.g. why a magic constant has
  its value). Never restate the next line; no multi-paragraph essays where a line will do.
- **Size is a smell, not a hard limit.** Treat these as "stop and look" triggers:
  - function longer than ~40 lines,
  - file longer than ~400 lines,
  - 3+ near-identical blocks.
  Current over-threshold files to split **when next touched:** `routers/explore.py` (~2200),
  `src/js/charts_share.js` (~900), `src/js/velocity.js` and `src/js/charts.js` (~560 each).

---

## 5. Security (OWASP-aware)

- **CORS:** `allow_origins=["*"]` together with `allow_credentials=True` is invalid per the CORS
  spec and unsafe — Starlette reflects the caller's origin. Resolved: `main.py` now takes an
  explicit env-driven allowlist (`REWIND_ALLOWED_ORIGINS`, default `null` so `file://` dev works)
  with `allow_credentials=False`, because the session ticket travels in the `X-Rewind-Session`
  header, not a cookie. Keep it that way — don't reintroduce `"*"` + credentials.
- **Session ticket:** the `X-Rewind-Session` UUID becomes part of a filename, so validate it
  against the ticket regex **before** building any path (path traversal). See `docs/MULTI_USER.md` §11.
- **Upload DoS:** `POST /api/upload` is capped by file count and total bytes (both env-tunable),
  checked at the middleware *and* while streaming — don't remove either gate.
- **No SQL injection:** parameterize or validate-then-inline (§2).
- **No XSS:** escape data-derived HTML (§3).
- **No secrets in source;** configuration comes from the environment (12-Factor III).

---

## 6. Known issues / tech debt

Fix each before the milestone in the "When" column. Update this table as items land.

| Item | Where | Type | When to fix |
|---|---|---|---|
| API base `http://127.0.0.1:8000` hardcoded + fallback re-inlined | 8 files: `api.js`, `top_card.js`, `total_time.js`, `heatmap.js`, `behavior.js`, `bar_race.js`, `velocity.js`, `upload.js` | Duplication / config | Before any non-local deploy — centralize on one base const + route all fetches through `fetchWithTimeout` |
| No Pydantic `response_model` on endpoints | all routers | Robustness / docs | When stabilizing the public API |
| `run_in_threadpool` + per-query `try/except` boilerplate | ~25 endpoints | Duplication | Low priority — extract a small query-runner helper |
| `routers/explore.py` ~2.2k lines (explore + charts + superlatives in one file) | backend | Size | Split into sub-routers (explore / charts) — overdue |
| `charts_share.js` ~900 lines, `velocity.js` / `charts.js` ~560 | frontend | Size | Split when next touched |
| No linter/formatter | repo | Consistency | Adopt `ruff` (check + format) anytime |

Paid down: CORS `*` + credentials (now an env allowlist with credentials off, §5).

---

## 7. Pre-merge checklist

- [ ] Backend tests green (`uv run pytest -q`) and `get_errors` clean on changed files.
- [ ] No new hardcoded host, secret, colour literal, or user-input-in-SQL; data-derived HTML escaped.
- [ ] UI changes checked in **both** themes (toggle light/dark) and in the empty state.
- [ ] New/changed behavior has a test.
- [ ] Functions/files within the size smells (§4), or a good reason not.
- [ ] Comments explain *why*; no dead/speculative code added.
- [ ] Docs updated if structure or behavior changed ([AGENTS.md](AGENTS.md), this file, relevant `docs/`).

---

## 8. References

- Google — *What to look for in a code review*: https://google.github.io/eng-practices/review/reviewer/looking-for.html
- Martin Fowler — *Code Smell*: https://martinfowler.com/bliki/CodeSmell.html
- *The Twelve-Factor App*: https://12factor.net/
- *FastAPI Best Practices* (zhanymkanov): https://github.com/zhanymkanov/fastapi-best-practices
- PEP 20 — *The Zen of Python*: https://peps.python.org/pep-0020/
