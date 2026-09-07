"""Upload & image endpoints: ingest history JSON, enrich against the catalog,
and serve cached cover art."""

import os
import shutil
import tempfile

import catalog
import images
from database import get_db, table_registry
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.engine import Connection
from starlette.concurrency import run_in_threadpool

router = APIRouter()

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
    try:
        for f in upload_list:
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
            shutil.copyfileobj(f.file, temp_file)
            temp_file.close()
            temp_paths.append(temp_file.name)

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

        table_registry.reset()

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


@router.post("/api/upload")
async def upload(
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

    try:
        result["enrichment"] = await run_in_threadpool(_enrich_session, conn)
    except Exception as e:
        # Enrichment is best-effort; ingestion already succeeded.
        result["enrichment"] = {"status": "error", "error": str(e)}

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
