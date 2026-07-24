import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from sqlalchemy import MetaData, Table, create_engine
from sqlalchemy.engine import Engine

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data", "sessions")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "rewind.duckdb")

metadata = MetaData()


class TableRegistry:
    def __init__(self):
        self._history_table: Table | None = None

    def get_history_table(self, engine: Engine) -> Table:
        if self._history_table is None:
            # Check if history table exists in DuckDB
            with engine.connect() as conn:
                tables = conn.exec_driver_sql(
                    "SELECT table_name FROM information_schema.tables WHERE table_name = 'history'"
                ).fetchall()
                if not tables:
                    raise HTTPException(
                        status_code=400,
                        detail="No listening history found. Please upload your Spotify data export first.",
                    )

            # Reflect the table schema via SQLAlchemy Core
            self._history_table = Table(
                "history", metadata, autoload_with=engine, extend_existing=True
            )

        return self._history_table

    def reset(self):
        """Reset cached reflected table schema after new uploads."""
        self._history_table = None


table_registry = TableRegistry()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application-wide SQLAlchemy Engine lifecycle."""
    engine = create_engine(f"duckdb:///{DB_PATH}")
    app.state.engine = engine
    yield
    engine.dispose()


def get_db(request: Request):
    """FastAPI Dependency for request-scoped database connections."""
    engine: Engine = request.app.state.engine
    with engine.connect() as connection:
        yield connection
