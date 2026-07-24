# Rewind — Backend Architecture

## Status

Not yet implemented. This file defines the architecture ahead of implementation. Referenced from `AGENTS.md`; kept as a separate file rather than merged into it.

## Architecture: FastAPI + DuckDB/SQLite, Session-Scoped

- **Framework:** FastAPI
- **Database:** DuckDB (or SQLite) — one database per upload session, not a shared multi-user table
- **Query layer:** SQLAlchemy Core (Table/select constructs), not raw SQL strings, for anything past initial ingestion

### Ingestion

On upload, the backend creates a session-scoped database file:

```
data/sessions/<session_id>.duckdb
```

`read_json_auto` is a DuckDB-native function with no SQLAlchemy equivalent, so ingestion is the one step that goes through DuckDB's own connection rather than the ORM layer. Column selection follows `SCHEMA.md` exactly — every field is kept except the two with genuine privacy risk:

```python
import duckdb

con = duckdb.connect(f"data/sessions/{session_id}.duckdb")
con.execute("""
    CREATE TABLE history AS
    SELECT
        ts,
        username,
        platform,
        ms_played,
        conn_country,
        master_metadata_track_name        AS track_name,
        master_metadata_album_artist_name  AS artist_name,
        master_metadata_album_album_name   AS album_name,
        spotify_track_uri                  AS track_uri,
        episode_name,
        episode_show_name,
        spotify_episode_uri                AS episode_uri,
        reason_start,
        reason_end,
        shuffle,
        skipped,
        offline,
        offline_timestamp,
        incognito_mode
    FROM read_json_auto(?)
""", [uploaded_file_path])
```

`ip_addr_decrypted` and `user_agent_decrypted` are the only two fields never named in this `SELECT` — see `SCHEMA.md` for the full field-by-field reasoning.

Spotify exports typically split history across multiple JSON files. All files for a session are ingested into the same `history` table, with deduplication applied at ingestion (on `track_uri` + `ts`).

### Querying

Everything after ingestion — column selection, filters, dashboard queries — goes through SQLAlchemy Core against a reflected `history` table, not string-built SQL:

```python
from sqlalchemy import create_engine, MetaData, Table, select

engine = create_engine(f"duckdb:///data/sessions/{session_id}.duckdb")
metadata = MetaData()
history = Table("history", metadata, autoload_with=engine)

stmt = select(
    history.c.ts,
    history.c.ms_played,
    history.c.track_name,
    history.c.artist_name,
    history.c.album_name,
    history.c.track_uri,
    history.c.skipped,
)

with engine.connect() as conn:
    rows = conn.execute(stmt).all()
```

This example selects just the columns the current Overview metrics need (see `SCHEMA.md`) — the full table has more columns available for future analysis. Dashboard interactions (tab switches, date-range filters) add `.where(...)` / `.order_by(...)` clauses to this same `select()` rather than re-parsing JSON or writing new raw queries per request.

## Data Handling

**Column selection:** every field from the Spotify export is stored except `ip_addr_decrypted` and `user_agent_decrypted` — network and device-fingerprint data with no analytical use case. These two are never named in the ingestion `SELECT` and therefore never written to disk. Full field-by-field reasoning lives in `SCHEMA.md`; individual queries still select only the columns a given feature needs.

**Session lifecycle:**
- Each session is identified by a generated ID (e.g. UUID), not tied to a user account
- No authentication; sessions are ephemeral by design
- Full request or file contents are not written to logs or error-tracking tools

**Transport:** HTTPS required in production.

## Open Items

- Session TTL and cleanup mechanism
- Deployment target and hosting setup
- API endpoint design (upload route, query routes, response schemas)

To be added as sections when decided, rather than restructuring the file.
