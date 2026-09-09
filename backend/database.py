import asyncio
import glob
import os
import re
import threading
import time
from collections import OrderedDict
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from sqlalchemy import MetaData, Table, create_engine
from sqlalchemy.engine import Engine

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SESSIONS_DIR = os.path.join(BASE_DIR, "..", "data", "sessions")
os.makedirs(SESSIONS_DIR, exist_ok=True)

# The ticket names a file on disk, so it is a path-traversal sink: validate the
# UUID shape before it ever reaches os.path.join. Rejects "..", slashes, etc.
_TICKET_RE = re.compile(r"^[0-9a-fA-F-]{36}$")

# Bound the number of open per-ticket engines so file handles can't leak under
# many concurrent guests; the LRU evicts (and disposes) the coldest.
_ENGINE_CACHE_MAX = int(os.getenv("REWIND_ENGINE_CACHE_MAX", "64"))

# Guests are ephemeral: delete session files idle longer than the TTL.
_SESSION_TTL_HOURS = float(os.getenv("REWIND_SESSION_TTL_HOURS", "48"))
_CLEANUP_INTERVAL_MIN = float(os.getenv("REWIND_CLEANUP_INTERVAL_MIN", "60"))

metadata = MetaData()


def session_db_path(ticket: str) -> str:
    """Validate the ticket and map it to its DuckDB file inside SESSIONS_DIR."""
    if not ticket or not _TICKET_RE.fullmatch(ticket):
        raise HTTPException(status_code=400, detail="Missing or invalid session.")
    return os.path.join(SESSIONS_DIR, f"{ticket}.duckdb")


class _EngineCache:
    """Thread-safe LRU of one SQLAlchemy Engine per ticket (one DuckDB file each)."""

    def __init__(self, maxsize: int):
        self._maxsize = maxsize
        self._lock = threading.Lock()
        self._engines: "OrderedDict[str, Engine]" = OrderedDict()

    def get(self, ticket: str) -> Engine:
        path = session_db_path(ticket)  # validates ticket, raises 400 if invalid
        with self._lock:
            engine = self._engines.get(ticket)
            if engine is not None:
                self._engines.move_to_end(ticket)
                return engine
            engine = create_engine(f"duckdb:///{path}")
            self._engines[ticket] = engine
            while len(self._engines) > self._maxsize:
                _, evicted = self._engines.popitem(last=False)
                evicted.dispose()
            return engine

    def dispose(self, ticket: str) -> None:
        with self._lock:
            engine = self._engines.pop(ticket, None)
        if engine is not None:
            engine.dispose()

    def dispose_all(self) -> None:
        with self._lock:
            engines = list(self._engines.values())
            self._engines.clear()
        for engine in engines:
            engine.dispose()


_engine_cache = _EngineCache(_ENGINE_CACHE_MAX)


def get_engine(ticket: str) -> Engine:
    """Return the cached duckdb:/// engine for this ticket, creating it lazily."""
    return _engine_cache.get(ticket)


def dispose_engine(ticket: str) -> None:
    """Drop a ticket's cached engine (e.g. before deleting its file)."""
    _engine_cache.dispose(ticket)


class TableRegistry:
    """Caches the reflected `history` table per ticket so one guest's schema is
    never served to another."""

    def __init__(self):
        self._tables: dict[str, Table] = {}
        self._lock = threading.Lock()

    def get_history_table(self, engine: Engine, ticket: str) -> Table:
        with self._lock:
            table = self._tables.get(ticket)
        if table is not None:
            return table

        # This session's file has no history until its first upload; keep the
        # existing empty-state contract (400 → frontend shows "no history").
        with engine.connect() as conn:
            tables = conn.exec_driver_sql(
                "SELECT table_name FROM information_schema.tables WHERE table_name = 'history'"
            ).fetchall()
            if not tables:
                raise HTTPException(
                    status_code=400,
                    detail="No listening history found. Please upload your Spotify data export first.",
                )

        table = Table(
            "history", metadata, autoload_with=engine, extend_existing=True
        )
        with self._lock:
            self._tables[ticket] = table
        return table

    def reset(self, ticket: str) -> None:
        """Drop a ticket's cached reflection so its next read picks up new data."""
        with self._lock:
            self._tables.pop(ticket, None)


table_registry = TableRegistry()


def _cleanup_stale_sessions() -> None:
    """Delete session DB files whose mtime is older than the TTL. Defensive: a
    failure on one file never stops the sweep or crashes the app."""
    cutoff = time.time() - _SESSION_TTL_HOURS * 3600
    for path in glob.glob(os.path.join(SESSIONS_DIR, "*.duckdb")):
        try:
            if os.path.getmtime(path) >= cutoff:
                continue
            ticket = os.path.splitext(os.path.basename(path))[0]
            dispose_engine(ticket)  # release the file handle before unlinking
            os.remove(path)
            wal = path + ".wal"  # DuckDB write-ahead log sidecar
            if os.path.exists(wal):
                os.remove(wal)
        except Exception:
            pass


async def _cleanup_loop() -> None:
    interval = _CLEANUP_INTERVAL_MIN * 60
    while True:
        await asyncio.sleep(interval)
        await asyncio.to_thread(_cleanup_stale_sessions)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App lifecycle: engines are created lazily per ticket. Runs the periodic
    TTL cleanup task and disposes all cached engines on shutdown."""
    cleanup_task = asyncio.create_task(_cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass
        _engine_cache.dispose_all()


def get_db(request: Request):
    """Request-scoped connection routed to the caller's per-ticket DuckDB file.

    Reads and validates `X-Rewind-Session`, then exposes the resolved engine and
    ticket on `request.state` so routers never reach for a global engine.
    """
    ticket = request.headers.get("X-Rewind-Session", "")
    engine = get_engine(ticket)  # validates the ticket, raises 400 if invalid
    request.state.engine = engine
    request.state.session_id = ticket
    with engine.connect() as connection:
        yield connection
