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

### Querying & Active Metric Endpoints

Everything after ingestion — column selection, filters, dashboard queries — goes through SQLAlchemy Core against the reflected `history` table, executed asynchronously via `run_in_threadpool`:

- **`POST /api/upload`**: Accepts single (`file`) or multiple (`files`) JSON exports; ingests data and returns total row count.
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

## Metadata Enrichment Pipeline (`load.py`)

After upload, the backend automatically enriches listening history with song metadata (duration, audio features, genre, images, release dates) from three external sources. Results are stored in a **shared persistent cache** (`data/metadata.duckdb`) that grows across users — popular tracks are fetched once and reused forever.

### Data Sources

| Source | Data Provided | Auth | Rate Limit |
|--------|--------------|------|------------|
| **Embeat 45M** (HuggingFace) | Audio features, duration, genre, popularity | HF token (`HF_TOKEN` env var) | N/A (bulk DuckDB query) |
| **Spotify oEmbed API** | Track/artist/album images | None | ~10 req/sec (conservative) |
| **Deezer API** | Album release dates | None | 50 req/5sec |

### Two-Phase Enrichment

**Phase 1 — Bulk metadata (fast, blocks):**
1. Extract unique `track_id`s from `history.track_uri` (strip `spotify:track:` prefix)
2. Check which IDs are already in `metadata.duckdb` (cache hit)
3. Query Embeat Parquet files via DuckDB `httpfs` for cache misses only
4. Resolve `artist_genre_idx` → genre name via `artist_genre_map.json`
5. Insert into `track_metadata` table

**Phase 2 — Images + dates (rate-limited):**
1. Fetch track images via Spotify oEmbed for tracks missing `image_url`
2. Fetch release dates via Deezer search for tracks missing `release_date`
3. Populate `artist_metadata` and `album_metadata` tables

### Cache Efficiency

The shared cache eliminates redundant external queries:
- User A uploads → 10,000 tracks queried, all cached
- User B uploads → 8,000 overlap → only 2,000 new queries
- Over time, query volume converges toward zero for popular music

### Configuration (`config.py` & `.env`)

The backend uses `pydantic-settings` (`backend/config.py`) to automatically load environment variables from `backend/.env`.

To set up environment variables:
```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:
```env
HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxx
```

Alternatively, pass it inline when running:
```bash
HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxx uv run fastapi dev main.py
```

Without a token, Phase 1 (audio features + genre) is skipped; Phase 2 (images + dates) still works.

## Open Items

- Session TTL and cleanup mechanism
- Multi-session isolation / UUID per user session
- Heatmap, most hated artist/track, active days, and unique songs metric endpoints
- Background async Phase 2 enrichment (currently runs synchronously after upload)
- Artist image enrichment (requires artist Spotify IDs, not available in history data)
