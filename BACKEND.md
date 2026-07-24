# Rewind — Backend Architecture

## Status

Implementation active in `backend/`. FastAPI + DuckDB + SQLAlchemy Core engine setup is implemented.

## Architecture: FastAPI + DuckDB, Session-Scoped

- **Framework:** FastAPI
- **Database:** DuckDB — session database stored at `data/sessions/rewind.duckdb`
- **Query layer:** SQLAlchemy Core (`Table`/`select` constructs), not raw SQL strings
- **Engine Lifecycle:** FastAPI `lifespan` context manager manages engine instance (`app.state.engine`); request-scoped connections yielded via `Depends(get_db)`.
- **Table Reflection:** Managed lazily by `TableRegistry` in `database.py` and reset post-upload (`table_registry.reset()`).

### Ingestion

On upload (`POST /api/upload`), the backend ingests Spotify Extended Streaming History JSON files into DuckDB using `read_json_auto(?, union_by_name=True)`. To avoid DuckDB connection configuration conflicts, ingestion executes via the driver connection of `get_db` (`conn.connection.driver_connection`).

Column selection follows `SCHEMA.md` doubling as source of truth — every field is kept except the two with genuine privacy risk (`ip_addr_decrypted` and `user_agent_decrypted`).

### Querying

Everything after ingestion — column selection, filters, dashboard queries — goes through SQLAlchemy Core against the reflected `history` table:

```python
from database import get_db, table_registry
from fastapi import Depends, FastAPI, Request
from sqlalchemy import func, select
from sqlalchemy.engine import Connection


@app.get("/api/metrics/total-time")
def get_total_time(
    request: Request,
    conn: Connection = Depends(get_db),
):
    history = table_registry.get_history_table(request.app.state.engine)
    stmt = select(func.coalesce(func.sum(history.c.ms_played), 0))
    total_ms = conn.execute(stmt).scalar() or 0
    total_minutes = round(total_ms / (1000 * 60), 2)
    return {"status": "ok", "total_minutes": total_minutes}
```

## Data Handling

**Column selection:** every field from the Spotify export is stored except `ip_addr_decrypted` and `user_agent_decrypted` — network and device-fingerprint data with no analytical use case. Excluded at ingestion.

**Session lifecycle:**
- Database stored in `data/sessions/rewind.duckdb`
- Ephemeral session design

## Open Items

- Session TTL and cleanup mechanism
- Multi-session isolation / UUID per user session
- Additional metric endpoints (top artist, top track, top album, heatmap, etc.)
