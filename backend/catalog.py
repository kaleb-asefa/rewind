"""Catalog enrichment: build a per-session ``track_features`` slice.

On upload we join the session's ``history`` against the read-only 45M-track catalog
(``catalog_sorted.parquet``) and materialize only the matched rows. All later dashboard
queries read that tiny table, so the multi-GB catalog is scanned once per upload, never
in a request path. The scan is memory-capped and streamed (spills to disk, never RAM).
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Read-only ordered catalog. Overridable so deployments/tests can point elsewhere.
CATALOG_PATH = os.environ.get(
    "REWIND_CATALOG_PATH",
    os.path.normpath(
        os.path.join(BASE_DIR, "..", "data", "metadata", "catalog_sorted.parquet")
    ),
)

# Guardrails so a full catalog scan can never exhaust RAM on small machines.
DUCKDB_MEMORY_LIMIT = os.environ.get("REWIND_DUCKDB_MEMORY_LIMIT", "2GB")
DUCKDB_THREADS = os.environ.get("REWIND_DUCKDB_THREADS", "2")
DUCKDB_TEMP_DIR = os.environ.get("REWIND_DUCKDB_TEMP_DIR")  # optional spill dir


def enrich_session(raw_con) -> dict:
    """Build/refresh ``track_features`` in the session DB from the catalog.

    ``raw_con`` is a raw DuckDB connection (``conn.connection.driver_connection``).
    Returns a status dict with match/coverage counts. Missing catalog is not an error.
    """
    if not os.path.exists(CATALOG_PATH):
        return {
            "status": "skipped",
            "reason": "catalog_missing",
            "matched": 0,
            "total": 0,
            "coverage": 0.0,
        }

    raw_con.execute(f"SET memory_limit='{DUCKDB_MEMORY_LIMIT}'")
    raw_con.execute(f"SET threads={DUCKDB_THREADS}")
    if DUCKDB_TEMP_DIR:
        os.makedirs(DUCKDB_TEMP_DIR, exist_ok=True)
        raw_con.execute(f"SET temp_directory='{DUCKDB_TEMP_DIR}'")

    # Tiny build side (user's distinct track_ids) probing the streamed 45M catalog.
    raw_con.execute(
        """
        CREATE OR REPLACE TABLE track_features AS
        SELECT c.*
        FROM read_parquet(?) AS c
        SEMI JOIN (
            SELECT DISTINCT replace(track_uri, 'spotify:track:', '') AS track_id
            FROM history
            WHERE track_uri LIKE 'spotify:track:%'
        ) AS h ON c.track_id = h.track_id
        """,
        [CATALOG_PATH],
    )

    matched = raw_con.execute("SELECT count(*) FROM track_features").fetchone()[0]
    total = raw_con.execute(
        """
        SELECT count(DISTINCT replace(track_uri, 'spotify:track:', ''))
        FROM history
        WHERE track_uri LIKE 'spotify:track:%'
        """
    ).fetchone()[0]

    return {
        "status": "ok",
        "matched": matched,
        "total": total,
        "coverage": round(matched / total, 4) if total else 0.0,
    }
