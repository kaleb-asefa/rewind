# Rewind — Backend Architecture

## Status

Implementation active in `backend/`. FastAPI + DuckDB + SQLAlchemy Core engine setup is implemented and verified.

## Architecture: FastAPI + DuckDB, Session-Scoped

- **Framework:** FastAPI
- **Database:** DuckDB — session database stored at `data/sessions/rewind.duckdb`
- **Query layer:** SQLAlchemy Core (`Table`/`select` constructs), not raw SQL strings
- **Engine Lifecycle:** FastAPI `lifespan` context manager manages engine instance (`app.state.engine`); request-scoped connections yielded via `Depends(get_db)`.
- **Table Reflection:** Managed lazily by `TableRegistry` in `database.py` and reset post-upload (`table_registry.reset()`).
- **Async Concurrency:** Blocking database query operations are offloaded to worker threads via FastAPI's `run_in_threadpool` to prevent event-loop blocking.

### Ingestion & Schema Normalization

On upload (`POST /api/upload`), the backend ingests single or multiple Spotify Extended Streaming History JSON files (`files: list[UploadFile]`) into DuckDB:
1. Uploaded files are written to temporary files and inspected via `read_json_auto(?, union_by_name=True)`.
2. Existing JSON keys are matched against the defined schema mapping (`MAPPING` in `main.py`).
3. Fields present in the export are safely converted via `TRY_CAST({col} AS {dtype})`, while missing schema fields default to `CAST(NULL AS {dtype})`.
4. The schema-normalized dataset is appended into the `history` table.
5. `table_registry.reset()` is invoked so reflected tables pick up new data cleanly.
6. **Catalog enrichment** (`catalog.py`): the upload then joins the session's distinct `track_id`s against the read-only 45M-track catalog (`data/metadata/catalog_sorted.parquet`) and materializes the matched rows into a small `track_features` table. The scan is memory-capped (`memory_limit`, `threads`) and streamed, so the multi-GB catalog is read once per upload, never in a metric request. Missing catalog = enrichment is skipped (ingestion still succeeds).

### Querying & Active Metric Endpoints

Everything after ingestion — column selection, filters, dashboard queries — goes through SQLAlchemy Core against the reflected `history` table, executed asynchronously via `run_in_threadpool`:

- **`POST /api/upload`**: Accepts single (`file`) or multiple (`files`) JSON exports; ingests data, builds the per-session `track_features` slice from the catalog, and returns the total row count plus an `enrichment` summary (`matched` / `total` / `coverage`).
- **`GET /api/metrics/total-time`**: Sums `ms_played` and converts to total minutes listening time.
- **`GET /api/metrics/top-artist`**: Aggregates streams and total listened minutes grouped by `artist_name`, returning top artist.
- **`GET /api/metrics/top-album`**: Aggregates streams and total listened minutes grouped by `album_name` & `artist_name`, returning top album.
- **`GET /api/metrics/top-track`**: Aggregates streams and total listened minutes grouped by `track_name` & `artist_name`, returning top track.

Example Endpoint Implementation:
```python
@app.get("/api/metrics/top-artist")
async def get_top_artist(
    request: Request,
    conn: Connection = Depends(get_db),
):
    def query():
        history = table_registry.get_history_table(request.app.state.engine)
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
- Database stored in `data/sessions/rewind.duckdb`
- Ephemeral session design

## Open Items

- Session TTL and cleanup mechanism
- Multi-session isolation / UUID per user session
- Heatmap, most hated artist/track, active days, and unique songs metric endpoints
