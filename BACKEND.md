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

`read_json_auto` is a DuckDB-native function with no SQLAlchemy equivalent, so ingestion is the one step that goes through DuckDB's own connection rather than the ORM layer:

```python
import duckdb

con = duckdb.connect(f"data/sessions/{session_id}.duckdb")
con.execute("CREATE TABLE history AS SELECT * FROM read_json_auto(?)", [uploaded_file_path])
```

Spotify exports typically split history across multiple JSON files. All files for a session are ingested into the same `history` table, with deduplication applied at ingestion.

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
    history.c.platform,
    history.c.conn_country,
)

with engine.connect() as conn:
    rows = conn.execute(stmt).all()
```

Dashboard interactions (tab switches, date-range filters) add `.where(...)` / `.order_by(...)` clauses to this same `select()` rather than re-parsing JSON or writing new raw queries per request.

## Data Handling

**Column selection:** only columns required by the dashboard are selected. `ip_addr` (present in Spotify's export as a historical connection-metadata field) is never included in a `select()` and therefore never read out of the reflected table.

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
