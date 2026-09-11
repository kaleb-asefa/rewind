"""Upload & image endpoints: ingest history JSON, enrich against the catalog,
and serve cached cover art."""

import asyncio
import os
import tempfile

import catalog
import images
from database import get_db, table_registry
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Request,
    UploadFile,
)
from sqlalchemy.engine import Connection, Engine
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

router = APIRouter()

# Each enrichment scans the shared catalog and uses ~2 GB RAM; bound how many run
# at once so concurrent guest uploads can't exhaust memory and crash the box.
_ENRICH_LIMIT = int(os.getenv("REWIND_MAX_CONCURRENT_ENRICH", "1"))
ENRICH_SEMAPHORE = asyncio.Semaphore(_ENRICH_LIMIT)

# Upload caps (anonymous tier, so anyone can post): defaults sit well above a real
# export — Spotify splits history into ~10 MB files, and even a 15-year account
# lands near 200 MB — while still bounding disk use per request.
MAX_UPLOAD_FILES = int(os.getenv("REWIND_MAX_UPLOAD_FILES", "50"))
MAX_UPLOAD_BYTES = int(float(os.getenv("REWIND_MAX_UPLOAD_MB", "512")) * 1024 * 1024)
_COPY_CHUNK_BYTES = 1024 * 1024


def _too_large_detail() -> str:
    # Report bytes below 1 MB; integer MB would render a confusing "0 MB limit".
    mb = MAX_UPLOAD_BYTES / (1024 * 1024)
    size = f"{mb:.0f} MB" if mb >= 1 else f"{MAX_UPLOAD_BYTES} bytes"
    return f"Upload exceeds the {size} limit."


async def enforce_upload_size_limit(request: Request, call_next):
    """Reject an oversized upload before Starlette spools its body to disk.

    Registered as HTTP middleware in `main.py`. Content-Length is client-supplied
    (and absent on chunked requests), so this only catches the cheap, honest case;
    `_process_upload` enforces the cap again on the bytes actually received.
    """
    if request.url.path == "/api/upload":
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
            return JSONResponse(status_code=413, content={"detail": _too_large_detail()})
    return await call_next(request)


def _copy_within_budget(src, dst, budget: int) -> int:
    """Stream `src` into `dst` in chunks, aborting once the byte budget is spent.

    Returns the budget left so it can be threaded across a multi-file upload,
    bounding the request as a whole rather than each file individually.
    """
    while True:
        chunk = src.read(_COPY_CHUNK_BYTES)
        if not chunk:
            return budget
        budget -= len(chunk)
        if budget < 0:
            raise HTTPException(status_code=413, detail=_too_large_detail())
        dst.write(chunk)

MAPPING = [
    ("ts", "ts", "TIMESTAMP"),
    ("username", "username", "VARCHAR"),
    ("platform", "platform", "VARCHAR"),
    ("ms_played", "ms_played", "BIGINT"),
    ("conn_country", "conn_country", "VARCHAR"),
    ("master_metadata_track_name", "track_name", "VARCHAR"),
    ("master_metadata_album_artist_name", "artist_name", "VARCHAR"),
    ("master_metadata_album_album_name", "album_name", "VARCHAR"),
    ("spotify_track_uri", "track_uri", "VARCHAR"),
    ("episode_name", "episode_name", "VARCHAR"),
    ("episode_show_name", "episode_show_name", "VARCHAR"),
    ("spotify_episode_uri", "episode_uri", "VARCHAR"),
    ("reason_start", "reason_start", "VARCHAR"),
    ("reason_end", "reason_end", "VARCHAR"),
    ("shuffle", "shuffle", "BOOLEAN"),
    ("skipped", "skipped", "BOOLEAN"),
    ("offline", "offline", "BOOLEAN"),
    ("offline_timestamp", "offline_timestamp", "TIMESTAMP"),
    ("incognito_mode", "incognito_mode", "BOOLEAN"),
]


def _process_upload(conn: Connection, upload_list: list[UploadFile]):
    temp_paths = []
    budget = MAX_UPLOAD_BYTES
    try:
        for f in upload_list:
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
            # Record the path before writing so an aborted copy is still cleaned up.
            temp_paths.append(temp_file.name)
            try:
                budget = _copy_within_budget(f.file, temp_file, budget)
            finally:
                temp_file.close()

        raw_con = conn.connection.driver_connection

        col_defs = [f"{target} {dtype}" for _, target, dtype in MAPPING]
        create_table_sql = f"CREATE TABLE IF NOT EXISTS history ({', '.join(col_defs)})"
        raw_con.execute(create_table_sql)

        describe_res = raw_con.execute(
            "DESCRIBE SELECT * FROM read_json_auto(?, union_by_name=True)", [temp_paths]
        ).fetchall()
        existing_cols = {row[0] for row in describe_res}

        select_exprs = []
        for src_col, target_col, dtype in MAPPING:
            if src_col in existing_cols:
                select_exprs.append(f"TRY_CAST({src_col} AS {dtype}) AS {target_col}")
            else:
                select_exprs.append(f"CAST(NULL AS {dtype}) AS {target_col}")

        select_clause = ",\n            ".join(select_exprs)

        insert_query = f"""
        INSERT INTO history
        SELECT
            {select_clause}
        FROM read_json_auto(?, union_by_name=True)
        """

        raw_con.execute(insert_query, [temp_paths])
        conn.commit()

        total_rows = raw_con.execute("SELECT count(*) FROM history").fetchone()[0]

        return {
            "status": "ok",
            "message": f"Successfully ingested {len(upload_list)} file(s) into DuckDB.",
            "files_processed": len(upload_list),
            "total_rows": total_rows,
        }
    finally:
        for path in temp_paths:
            if os.path.exists(path):
                try:
                    os.remove(path)
                except Exception:
                    pass


def _enrich_session(conn: Connection) -> dict:
    """Materialize the track_features slice by joining history against the catalog."""
    result = catalog.enrich_session(conn.connection.driver_connection)
    conn.commit()
    return result


# Cover pre-warm: the id sets every chart lands on (bar race, velocity, charts
# leaderboard, taste gems, deep cuts, …) are the top artists/tracks/albums by
# listening. The long tail (e.g. a single year's top 50) is warmed on demand by
# the /api/images retry path instead.
_PREWARM_LIMIT = 50


def _collect_prewarm_sets(conn: Connection) -> dict[str, list[str]]:
    """Top artist / track / album spotify ids to warm the cover cache for.

    Tracks come straight from ``track_uri``; artist/album ids come from the
    enriched ``track_features`` slice (absent when the catalog is missing, in
    which case those kinds are simply skipped).
    """
    raw_con = conn.connection.driver_connection
    sets: dict[str, list[str]] = {}

    try:
        sets["track"] = [
            r[0]
            for r in raw_con.execute(
                "SELECT split_part(track_uri, ':', 3) AS id, SUM(ms_played) AS ms "
                "FROM history WHERE track_uri LIKE 'spotify:track:%' "
                f"GROUP BY id ORDER BY ms DESC LIMIT {_PREWARM_LIMIT}"
            ).fetchall()
        ]
    except Exception:
        sets["track"] = []

    for kind, col in (("artist", "artist_id"), ("album", "album_id")):
        try:
            sets[kind] = [
                r[0]
                for r in raw_con.execute(
                    f"SELECT f.{col} AS id, SUM(h.ms_played) AS ms "
                    "FROM history h JOIN track_features f "
                    "ON split_part(h.track_uri, ':', 3) = f.track_id "
                    f"WHERE f.{col} IS NOT NULL "
                    f"GROUP BY id ORDER BY ms DESC LIMIT {_PREWARM_LIMIT}"
                ).fetchall()
            ]
        except Exception:
            sets[kind] = []  # track_features missing (no catalog) — skip this kind

    return sets


def _warm_covers(engine: Engine, sets_by_kind: dict[str, list[str]]) -> None:
    """Background job: warm the cover cache on a fresh session connection.

    Runs after the upload response is sent, so it never blocks the request and
    can't collide with the handler's own writes (that connection has committed
    and closed by now). Best-effort — any failure is swallowed.
    """
    try:
        with engine.connect() as warm_conn:
            images.prewarm_session_covers(
                warm_conn.connection.driver_connection, sets_by_kind
            )
            warm_conn.commit()
    except Exception:
        pass


@router.post("/api/upload")
async def upload(
    background_tasks: BackgroundTasks,
    request: Request,
    file: UploadFile = File(None),
    files: list[UploadFile] = File(None),
    conn: Connection = Depends(get_db),
):
    upload_list = []
    if files:
        upload_list.extend(files)
    if file:
        upload_list.append(file)

    upload_list = [f for f in upload_list if f is not None]

    if not upload_list:
        raise HTTPException(status_code=400, detail="No files provided for upload.")

    if len(upload_list) > MAX_UPLOAD_FILES:
        raise HTTPException(
            status_code=413,
            detail=f"Too many files: {len(upload_list)} (limit {MAX_UPLOAD_FILES}).",
        )

    for f in upload_list:
        if not f.filename.endswith(".json"):
            raise HTTPException(
                status_code=400,
                detail=f"File '{f.filename}' is not a supported JSON file.",
            )

    try:
        result = await run_in_threadpool(_process_upload, conn, upload_list)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to ingest JSON into DuckDB: {str(e)}"
        )

    # Fresh data landed: drop this session's cached reflection so reads re-reflect.
    table_registry.reset(request.state.session_id)

    try:
        async with ENRICH_SEMAPHORE:
            result["enrichment"] = await run_in_threadpool(_enrich_session, conn)
    except Exception as e:
        # Enrichment is best-effort; ingestion already succeeded.
        result["enrichment"] = {"status": "error", "error": str(e)}

    # Pre-warm cover art for the top artists/tracks/albums the charts land on.
    # Best-effort and non-blocking: the response returns now, the warm job runs
    # after on a fresh connection.
    try:
        prewarm_sets = await run_in_threadpool(_collect_prewarm_sets, conn)
        background_tasks.add_task(_warm_covers, conn.engine, prewarm_sets)
    except Exception:
        pass

    return result


@router.get("/api/image")
async def get_image(
    kind: str,
    id: str,
    conn: Connection = Depends(get_db),
):
    """Return a cached Spotify cover URL for an artist/album/track id."""
    if kind not in {"artist", "album", "track"}:
        raise HTTPException(status_code=400, detail="Invalid image kind.")

    def work():
        url = images.get_or_fetch(conn.connection.driver_connection, kind, id)
        conn.commit()
        return url

    url = await run_in_threadpool(work)
    return {"status": "ok", "image_url": url}


@router.get("/api/images")
async def get_images(
    kind: str,
    ids: str,
    conn: Connection = Depends(get_db),
):
    """Batch-resolve cover URLs for many ids in one call (comma-separated).

    Collapses N per-image round-trips into one and fetches the cache misses
    concurrently, so a whole chart's covers land together instead of trickling.
    """
    if kind not in {"artist", "album", "track"}:
        raise HTTPException(status_code=400, detail="Invalid image kind.")
    id_list = [i for i in ids.split(",") if i][:200]

    def work():
        result = images.get_or_fetch_many(conn.connection.driver_connection, kind, id_list)
        conn.commit()
        return result

    result = await run_in_threadpool(work)
    return {"status": "ok", "images": result}
