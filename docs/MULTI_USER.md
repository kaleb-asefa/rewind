# Rewind — Multi-User Guest MVP (Backend Build Spec)

> **Status:** ✅ **implemented** (backend + the §15 frontend seam are merged to
> `main`). Kept as the reference for *why* the guest tier is built this way.
> This was an actionable build spec for the **backend agent** (owns `backend/**`).
> It turns Rewind from a
> single-user local app into a **multi-user, guest-only** app that many people can
> use at the same time — **no accounts, no login** (that's a later phase).
>
> Companion docs: `ARCHITECTURE.md` (long-term vision incl. the accounts tier +
> Postgres), `CODE_QUALITY.md` (engineering rules — follow them), `API_CONTRACT.md`
> (the frontend↔backend seam — the one frontend change below goes there first),
> `DEPLOYMENT.md` (how it gets hosted — **deliberately out of scope here**).

---

## 1. Goal & scope

**Goal:** two strangers can open the app, each upload their own Spotify history,
and each see **only their own** dashboard — concurrently, without crashing the box.

**In scope (this milestone):**
1. Per-visitor **session isolation** — one DuckDB file per guest.
2. **Concurrency safety** for the heavy catalog enrichment (bounded RAM).
3. A **CORS** fix (the current `*` + credentials combo is invalid/unsafe).
4. **TTL cleanup** of stale guest sessions.

**Explicitly NOT in this milestone** (see `ARCHITECTURE.md`):
- User accounts, auth, or a leaderboard.
- Postgres (guest MVP uses **one DuckDB file per session** — the `ARCHITECTURE.md`
  §6.3 shortcut). Postgres is the accounts-tier upgrade, later.
- Deployment/hosting (Docker, reverse proxy, TLS) — that's `DEPLOYMENT.md`.

---

## 2. The problem today (why it's single-user)

Everything funnels through **one global engine → one `data/sessions/rewind.duckdb`**,
plus a **global `table_registry` singleton** caching the reflected `history` table
across all requests:

- `database.py` builds one `create_engine(...)` in `lifespan`, stored on
  `app.state.engine`; `get_db` yields connections from it.
- `overview.py` reads `request.app.state.engine` and the shared `table_registry`.
- `explore.py` / `upload.py` use the raw connection via
  `conn.connection.driver_connection`.

Two users uploading would share one `history` table, and the cached reflection
could serve one person's schema to another. That's the whole bug.

---

## 3. Confirmed decisions

| Decision | Choice | Why |
|---|---|---|
| Identity | **Client-generated ticket** (UUID) in `localStorage`, sent as header `X-Rewind-Session` | Works in `file://` dev *and* same-origin prod; no cookie/credentials CORS pain; 122-bit random = unguessable, fine for a no-login tier |
| User store | **One DuckDB file per ticket**: `data/sessions/<ticket>.duckdb` | Isolation for free; cleanup = delete file; no shared-writer contention |
| Catalog | **Unchanged** — shared, read-only `data/metadata/catalog_sorted.parquet` | Concurrent reads are safe; each session reads it via `read_parquet` during enrichment |
| Enrichment | **Global semaphore**, 1–2 concurrent | Each enrichment uses ~2 GB RAM; unbounded concurrency crashes the box |
| Cleanup | Background task deletes session files idle > TTL (default 48h) | Guests are ephemeral |

---

## 4. Session identity — the ticket contract

**Frontend (one change, hand off via `API_CONTRACT.md` → frontend agent):**
- On first load, `api.js` generates a ticket and persists it:
  ```js
  let t = localStorage.getItem("rewind_session");
  if (!t) { t = crypto.randomUUID(); localStorage.setItem("rewind_session", t); }
  ```
- `window.fetchWithTimeout` attaches it to **every** `/api` request:
  `headers: { "X-Rewind-Session": t }`.

**Backend contract:**
- Every `/api/**` request carries `X-Rewind-Session: <uuid>`.
- The ticket **names a file on disk**, so it MUST be validated before use
  (see §11 security — this is a path-traversal sink).
- Missing/invalid ticket → **`400`** (`{"detail": "Missing or invalid session."}`).
  The frontend always sends one, so this only fires on direct/abusive calls.

> Empty-state behavior is preserved: before any upload the session's `history`
> table doesn't exist yet, so read endpoints hit the existing "no history" path
> and return the same empty state they do today.

---

## 5. Storage layout

```
data/sessions/
  <ticket-1>.duckdb        # guest 1's history + track_features + images
  <ticket-2>.duckdb        # guest 2's — fully isolated
  ...
data/metadata/
  catalog_sorted.parquet   # shared, read-only (unchanged)
```

Retire the single fixed `rewind.duckdb`. Nothing shares a session file.

---

## 6. `database.py` — from global engine to per-ticket router

This is the heart of the change. Keep the SQLAlchemy-Core approach; only the
**routing** changes.

- **Ticket validation + path builder** (strict — see §11):
  ```python
  import re
  _TICKET_RE = re.compile(r"^[0-9a-fA-F-]{36}$")  # UUID shape only

  def session_db_path(ticket: str) -> str:
      if not ticket or not _TICKET_RE.fullmatch(ticket):
          raise HTTPException(status_code=400, detail="Missing or invalid session.")
      return os.path.join(SESSIONS_DIR, f"{ticket}.duckdb")
  ```
- **Per-ticket engine cache** (bounded; dispose on eviction so file handles don't
  leak). A simple dict + `threading.Lock`, with an LRU cap (e.g. 64) is enough:
  ```python
  def get_engine(ticket: str) -> Engine:
      # returns a cached duckdb:/// engine for this ticket, creating lazily
  ```
- **`get_db` resolves the ticket → engine**, and exposes both on `request.state`
  so routers stop reaching for the global `app.state.engine`:
  ```python
  def get_db(request: Request):
      ticket = request.headers.get("X-Rewind-Session", "")
      engine = get_engine(ticket)              # validates ticket internally
      request.state.engine = engine
      request.state.session_id = ticket
      with engine.connect() as conn:
          yield conn
  ```
- **`table_registry` becomes per-ticket** — key the reflected `history` table by
  ticket instead of one global slot:
  ```python
  class TableRegistry:
      def __init__(self): self._tables: dict[str, Table] = {}
      def get_history_table(self, engine, ticket) -> Table: ...
      def reset(self, ticket) -> None: self._tables.pop(ticket, None)
  ```
- **`lifespan`** no longer opens one engine; it starts/stops the cleanup task
  (§9) and disposes any cached engines on shutdown.

---

## 7. Router changes (small)

- **`overview.py`** — replace `request.app.state.engine` with
  `request.state.engine`, and pass `request.state.session_id` into
  `table_registry.get_history_table(...)`. No SQL changes.
- **`explore.py`** — **no change needed**. Its endpoints already take the
  connection from `Depends(get_db)` and use `conn.connection.driver_connection`;
  once `get_db` is per-ticket, explore is automatically isolated.
- **`upload.py`** — see §8.

---

## 8. Upload + enrichment concurrency

- Upload endpoint takes the session connection from `Depends(get_db)` (so the
  session file is created on first write). `_process_upload` is unchanged.
- Call `table_registry.reset(request.state.session_id)` after ingest (not the
  old global `reset()`).
- **Wrap enrichment in a global semaphore** so concurrent uploads can't each grab
  ~2 GB:
  ```python
  import asyncio, os
  _ENRICH_LIMIT = int(os.getenv("REWIND_MAX_CONCURRENT_ENRICH", "1"))
  ENRICH_SEMAPHORE = asyncio.Semaphore(_ENRICH_LIMIT)

  async with ENRICH_SEMAPHORE:
      result = await run_in_threadpool(_enrich_session, conn)
  ```
  Enrichment stays best-effort (existing try/except); a missing catalog still
  skips gracefully.
- **`catalog.py`** — unchanged (already memory-capped: `memory_limit`, `threads`,
  optional `temp_directory`; reads the shared parquet via the session's con).

---

## 9. TTL cleanup task

- A periodic `asyncio` task started in `lifespan`:
  - Every `REWIND_CLEANUP_INTERVAL_MIN` (default 60), scan `data/sessions/*.duckdb`.
  - Delete files whose **mtime** is older than `REWIND_SESSION_TTL_HOURS`
    (default 48). Dispose the cached engine first; skip the `.wal` sidecar's live
    session (don't delete a file modified in the last few minutes).
- Keep it dead simple and defensive (wrap each delete in try/except; never crash
  the app on a cleanup error).

---

## 10. CORS fix (`main.py`)

Replace the current invalid combo:
```python
allow_origins=["*"], allow_credentials=True   # ❌ invalid + unsafe
```
with an **env-driven allowlist** (we use a custom header, not cookies, so
credentials stay **off**):
```python
_origins = os.getenv("REWIND_ALLOWED_ORIGINS", "null").split(",")
allow_origins=_origins, allow_credentials=False,
allow_methods=["*"], allow_headers=["*"],   # must allow X-Rewind-Session
```
- Default includes `"null"` so `file://` dev keeps working; production sets
  `REWIND_ALLOWED_ORIGINS=https://rewind.<domain>`.

---

## 11. Security checklist (OWASP)

- **Path traversal (A01/A03) — critical.** The ticket becomes part of a filename.
  Validate against `_TICKET_RE` **before** building any path; never `os.path.join`
  a raw header. Reject `..`, slashes, anything non-UUID → `400`.
- **CORS (A05).** No more `*` + credentials; explicit origin allowlist (§10).
- **Upload DoS (A05).** ✅ Two gates, because `Content-Length` is client-supplied
  (and absent on chunked requests): `enforce_upload_size_limit` middleware rejects an
  oversized declared body **before** Starlette spools it to disk, and
  `_copy_within_budget` re-checks the bytes actually received while streaming each
  file to its temp path. File count is capped separately. Both → `413`.
- **No secrets** in code or this doc; all tunables are env vars (§13).
- **SQL:** no user input in SQL strings (unchanged rule from `CODE_QUALITY.md`);
  the ticket never touches SQL, only the filesystem path (validated).

---

## 12. Build order (tests green at each step)

1. `database.py`: ticket validation, `SESSIONS_DIR`, per-ticket engine cache,
   per-ticket `table_registry`, `get_db` sets `request.state`.
2. `overview.py`: switch to `request.state.engine` + ticket-keyed registry.
3. `upload.py`: `reset(ticket)` + enrichment semaphore.
4. `main.py`: CORS allowlist.
5. `lifespan`: start/stop the TTL cleanup task; dispose engines on shutdown.
6. Tests: update fixtures + add isolation test (§13).
7. Hand off the `api.js` ticket-header change to the **frontend agent** via
   `API_CONTRACT.md` (backend is done once it *requires* the header).

---

## 13. Test plan

Current suite monkeypatches `database.DB_PATH` to a temp file and calls endpoints
with no ticket; an autouse fixture points `catalog.CATALOG_PATH` at a missing file
so uploads skip enrichment. Update to the ticket model:

- Fixture: monkeypatch `database.SESSIONS_DIR` → `tmp_path`; give the `TestClient`
  a default header `client.headers["X-Rewind-Session"] = "<fixed-test-uuid>"`.
- Preserve the re-export contract: `main._enrich_session` and `main._WEEKDAY_NAMES`
  must still resolve (tests import them).
- **New test — isolation:** upload under ticket A; a request under ticket B sees
  the empty state (separate file). Confirms the whole point of this milestone.
- **New test — bad ticket:** missing / `../evil` / non-UUID header → `400`.
- All existing upload/metric tests keep passing (now scoped to the test ticket).

**Acceptance criteria**
- Two tickets → two isolated histories; neither sees the other's data.
- N concurrent uploads never exceed `REWIND_MAX_CONCURRENT_ENRICH` enrichments.
- Invalid/missing ticket → `400`, no file created outside `SESSIONS_DIR`.
- Stale session files are deleted after the TTL.
- `uv run pytest -q` green.

---

## 14. Env vars (new)

| Var | Default | Purpose |
|---|---|---|
| `REWIND_ALLOWED_ORIGINS` | `null` | CORS allowlist (comma-separated) |
| `REWIND_MAX_CONCURRENT_ENRICH` | `1` | Enrichment semaphore size |
| `REWIND_SESSION_TTL_HOURS` | `48` | Guest session lifetime |
| `REWIND_CLEANUP_INTERVAL_MIN` | `60` | Cleanup scan interval |
| `REWIND_MAX_UPLOAD_FILES` | `50` | Max files per upload request |
| `REWIND_MAX_UPLOAD_MB` | `512` | Max total upload size per request |

(Existing `REWIND_CATALOG_PATH`, `REWIND_DUCKDB_*`, `REWIND_TZ_OFFSET_HOURS`, etc.
are unchanged.)

---

## 15. Frontend seam (for `API_CONTRACT.md`)

Only one frontend change, owned by the frontend agent:
> All `/api/**` requests must include header `X-Rewind-Session: <uuid>`, generated
> once and stored in `localStorage["rewind_session"]`, attached inside
> `window.fetchWithTimeout`. No response shapes change.

Add this to `API_CONTRACT.md` **before** the frontend branch diverges.
