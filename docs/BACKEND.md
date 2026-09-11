# Rewind — Backend Architecture

## Status

Implementation active in `backend/`. FastAPI + DuckDB + SQLAlchemy Core engine setup is implemented and verified.

## Architecture: FastAPI + DuckDB, Session-Scoped

- **Framework:** FastAPI
- **Database:** DuckDB — **one file per guest**, `data/sessions/<ticket>.duckdb`, keyed by the `X-Rewind-Session` UUID header so guests are fully isolated (see `MULTI_USER.md`).
- **Query layer:** SQLAlchemy Core (`Table`/`select` constructs), not raw SQL strings
- **Engine Lifecycle:** `get_db` reads and validates the ticket, resolves it through a bounded per-ticket engine cache (`get_engine`), and exposes the engine + session id on `request.state`. The `lifespan` runs the TTL cleanup task and disposes cached engines on shutdown.
- **Table Reflection:** Managed lazily and **per ticket** by `TableRegistry` in `database.py`, reset after each upload (`table_registry.reset(session_id)`).
- **Async Concurrency:** Blocking database query operations are offloaded to worker threads via FastAPI's `run_in_threadpool` to prevent event-loop blocking.

### Ingestion & Schema Normalization

On upload (`POST /api/upload`), the backend ingests single or multiple Spotify Extended Streaming History JSON files (`files: list[UploadFile]`) into DuckDB:
0. **Caps first.** At most `REWIND_MAX_UPLOAD_FILES` (default 50) `.json` files totalling
   `REWIND_MAX_UPLOAD_MB` (default 512 MB) per request → otherwise `413`. Enforced twice because
   `Content-Length` is client-supplied: the `enforce_upload_size_limit` middleware rejects an
   oversized declared body before Starlette spools it to disk, and `_copy_within_budget` re-checks
   the bytes actually received while streaming each file to its temp path.
1. Uploaded files are written to temporary files and inspected via `read_json_auto(?, union_by_name=True)`.
2. Existing JSON keys are matched against the defined schema mapping (`MAPPING` in `routers/upload.py`).
3. Fields present in the export are safely converted via `TRY_CAST({col} AS {dtype})`, while missing schema fields default to `CAST(NULL AS {dtype})`.
4. The schema-normalized dataset is appended into the `history` table.
5. `table_registry.reset(session_id)` is invoked so the session's reflected table picks up new data cleanly.
6. **Catalog enrichment** (`catalog.py`): the upload then joins the session's distinct `track_id`s against the read-only 45M-track catalog (`data/metadata/catalog_sorted.parquet`) and materializes the matched rows into a small `track_features` table. The scan is memory-capped (`memory_limit`, `threads`) and streamed, so the multi-GB catalog is read once per upload, never in a metric request. Missing catalog = enrichment is skipped (ingestion still succeeds).

### Querying & Active Metric Endpoints

Everything after ingestion — column selection, filters, dashboard queries — goes through SQLAlchemy Core against the reflected `history` table, executed asynchronously via `run_in_threadpool`:

- **`POST /api/upload`**: Accepts single (`file`) or multiple (`files`) JSON exports; ingests data, builds the per-session `track_features` slice from the catalog, and returns the total row count plus an `enrichment` summary (`matched` / `total` / `coverage`).
- **`GET /api/metrics/total-time`**: Sums `ms_played` and converts to total minutes listening time.
- **`GET /api/metrics/top-artist`**: Aggregates streams and total listened minutes grouped by `artist_name`, returning top artist.
- **`GET /api/metrics/top-album`**: Aggregates streams and total listened minutes grouped by `album_name` & `artist_name`, returning top album.
- **`GET /api/metrics/top-track`**: Aggregates streams and total listened minutes grouped by `track_name` & `artist_name`, returning top track.
- **`GET /api/image?kind=&id=`**: Returns a cached Spotify cover URL (oEmbed) for an `artist`/`album`/`track` id; fetches once and caches in the session `images` table. `GET /api/images?kind=&ids=` is the batched form (≤200 ids, concurrent fetch, one bulk cache read/write) and is what the frontend uses. The `top-artist/album/track` endpoints also return the entity's Spotify id so the frontend can lazy-load covers.

### Cover identity (`covers.py`)

`images.py` answers *"what is the art for this `(kind, id)`"*; `covers.py` answers the step
before it — *"which id represents this entity's art"* — for entities whose id isn't in the
upload. Tracks are trivial (`history.track_uri`). Albums are not, and used to be matched by
comparing two independently-produced name strings (`history.album_name/artist_name` vs the
catalog's), which disagree over edition suffixes, casing and diacritics — every disagreement
yielded a `NULL` id and no cover was ever requested. Resolution is now identity-based:

1. `history.track_uri` → `track_features.track_id` → `album_id` — an exact key join, no names
   involved. When a title maps to several catalog albums the **most-played edition** wins
   (`arg_max` on listening time) rather than an arbitrary `MAX()`.
2. No catalog row for any of the album's tracks (a release newer than the catalog snapshot, or
   enrichment skipped entirely) → fall back to a representative `track_id` from that album.
   A track's oEmbed thumbnail *is* its album cover, so only the id kind differs.

Callers get `(album_id, cover_kind, cover_id)`; `attach_album_cover_refs` writes them onto
items in place. `_attach_image_urls` batches its cached lookups **per `cover_kind`**, and the
upload pre-warm seeds the tier-2 track ids alongside the album ids. Everything is best-effort
(empty dict on failure) so a missing `track_features` table never breaks a response.

**Explore + Charts metrics** live in `routers/explore.py` and query the raw DuckDB connection
(SQL-first, still via `run_in_threadpool`) rather than SQLAlchemy Core, because the window
functions and gaps-and-islands queries they need have no clean Core expression.

- **Year filter.** Every explore endpoint takes `year=all` (default) or a 4-digit year;
  `_parse_year` validates it (anything else → `400`) and `_year_clause` appends
  `AND EXTRACT(year FROM ts + to_minutes(<offset>)) = YYYY` — both values are validated ints,
  inlined as literals so the expression stays byte-identical in `SELECT`/`GROUP BY`
  (a `?` placeholder there breaks DuckDB's group-by expression matching). Year boundaries use
  the same per-user local-time shift as the rest of the app. `GET /api/metrics/years` lists the
  years the session has plays in, with `streams`/`minutes` per year, for the filter control.
- **Charts** (`/api/metrics/chart`, `/api/metrics/superlatives`) keep their own
  `range=all|YYYY|4w|6m` param instead — they are not part of the year filter.

Example Endpoint Implementation:
```python
@app.get("/api/metrics/top-artist")
async def get_top_artist(
    request: Request,
    conn: Connection = Depends(get_db),
):
    def query():
        history = table_registry.get_history_table(request.state.engine, request.state.session_id)
        stmt = (
            select(
                history.c.artist_name,
                func.count().label("total_streams"),
                func.coalesce(func.sum(history.c.ms_played), 0).label("total_ms"),
            )
            .where(history.c.artist_name.isnot(None))
            .group_by(history.c.artist_name)
            .order_by(func.count().desc())
            .limit(1)
        )
        return conn.execute(stmt).first()

    row = await run_in_threadpool(query)
    ...
```

## Frontend Integration Layer

The frontend communicates with FastAPI endpoints via `src/js/api.js`:
- Centralized `fetchAPI` helper with built-in timeout handling and automatic fallback to relative paths when API host port varies.
- Skeleton loader integration across dashboard cards while async metric queries resolve.
- Debounced initial data loads and event-driven refreshes (`data-updated` event) post-upload.

## Data Handling

**Column selection:** every field from the Spotify export is stored except `ip_addr_decrypted` and `user_agent_decrypted` — network and device-fingerprint data with no analytical use case. Excluded at ingestion.

**Session lifecycle:**
- One DuckDB file per guest ticket at `data/sessions/<ticket>.duckdb`
- Ephemeral by design — a background task deletes session files idle past `REWIND_SESSION_TTL_HOURS` (default 48)

## Open Items

- **Most hated artist / track** — still hardcoded placeholders on `overview.html`; the ranking
  method is prototyped in `notebooks/` (completion ratio + intent-aware rejection), not wired up.
- **Explore year filter — frontend half.** The API is live; the control and wiring are not built
  yet (see `docs/FRONTEND_YEAR_FILTER.md`).
