import os
import shutil
import tempfile

import duckdb
from database import DB_PATH, get_db, lifespan, table_registry
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.engine import Connection
from starlette.concurrency import run_in_threadpool

app = FastAPI(title="Rewind API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


@app.post("/api/upload")
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
        return await run_in_threadpool(_process_upload, conn, upload_list)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to ingest JSON into DuckDB: {str(e)}"
        )


@app.get("/api/metrics/total-time")
async def get_total_time(
    request: Request,
    conn: Connection = Depends(get_db),
):
    def query():
        history = table_registry.get_history_table(request.app.state.engine)
        stmt = select(func.coalesce(func.sum(history.c.ms_played), 0))
        return conn.execute(stmt).scalar() or 0

    total_ms = await run_in_threadpool(query)
    total_minutes = round(total_ms / (1000 * 60), 2)

    return {
        "status": "ok",
        "total_minutes": total_minutes,
    }


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

    if not row:
        return {
            "status": "ok",
            "artist_name": None,
            "total_streams": 0,
            "total_minutes": 0,
        }

    return {
        "status": "ok",
        "artist_name": row.artist_name,
        "total_streams": row.total_streams,
        "total_minutes": round(row.total_ms / (1000 * 60), 2),
    }


@app.get("/api/metrics/top-album")
async def get_top_album(
    request: Request,
    conn: Connection = Depends(get_db),
):
    def query():
        history = table_registry.get_history_table(request.app.state.engine)
        stmt = (
            select(
                history.c.album_name,
                history.c.artist_name,
                func.count().label("total_streams"),
                func.coalesce(func.sum(history.c.ms_played), 0).label("total_ms"),
            )
            .where(history.c.album_name.isnot(None))
            .group_by(history.c.album_name, history.c.artist_name)
            .order_by(func.count().desc())
            .limit(1)
        )
        return conn.execute(stmt).first()

    row = await run_in_threadpool(query)

    if not row:
        return {
            "status": "ok",
            "album_name": None,
            "artist_name": None,
            "total_streams": 0,
            "total_minutes": 0,
        }

    return {
        "status": "ok",
        "album_name": row.album_name,
        "artist_name": row.artist_name,
        "total_streams": row.total_streams,
        "total_minutes": round(row.total_ms / (1000 * 60), 2),
    }


@app.get("/api/metrics/top-track")
async def get_top_track(
    request: Request,
    conn: Connection = Depends(get_db),
):
    def query():
        history = table_registry.get_history_table(request.app.state.engine)
        stmt = (
            select(
                history.c.track_name,
                history.c.artist_name,
                func.count().label("total_streams"),
                func.coalesce(func.sum(history.c.ms_played), 0).label("total_ms"),
            )
            .where(history.c.track_name.isnot(None))
            .group_by(history.c.track_name, history.c.artist_name)
            .order_by(func.count().desc())
            .limit(1)
        )
        return conn.execute(stmt).first()

    row = await run_in_threadpool(query)

    if not row:
        return {
            "status": "ok",
            "track_name": None,
            "artist_name": None,
            "total_streams": 0,
            "total_minutes": 0,
        }

    return {
        "status": "ok",
        "track_name": row.track_name,
        "artist_name": row.artist_name,
        "total_streams": row.total_streams,
        "total_minutes": round(row.total_ms / (1000 * 60), 2),
    }


@app.get("/api/metrics/artist-rank")
async def get_artist_rank(
    request: Request,
    limit: int = 10,
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
            .order_by(func.coalesce(func.sum(history.c.ms_played), 0).desc(), func.count().desc())
            .limit(limit)
        )
        rows = conn.execute(stmt).fetchall()

        raw_con = conn.connection.driver_connection
        try:
            monthly_rows = raw_con.execute("""
                SELECT 
                    artist_name,
                    date_trunc('month', ts) as month,
                    SUM(ms_played) as ms
                FROM history
                WHERE artist_name IS NOT NULL AND ts IS NOT NULL
                GROUP BY artist_name, month
            """).fetchall()
        except Exception:
            monthly_rows = []

        months_set = sorted({row[1] for row in monthly_rows})
        artist_month_ms = {}
        for artist, month, ms in monthly_rows:
            if artist not in artist_month_ms:
                artist_month_ms[artist] = {}
            artist_month_ms[artist][month] = ms

        result = []
        for idx, row in enumerate(rows, start=1):
            artist_name = row.artist_name
            monthly_ranks = []
            if months_set:
                for month in months_set:
                    m_scores = [(a, m_dict.get(month, 0)) for a, m_dict in artist_month_ms.items()]
                    m_scores.sort(key=lambda x: x[1], reverse=True)
                    m_rank = 8
                    for r_idx, (a, score) in enumerate(m_scores, start=1):
                        if a == artist_name:
                            m_rank = r_idx
                            break
                    monthly_ranks.append(min(m_rank, 8))

            if len(monthly_ranks) < 36:
                if monthly_ranks:
                    monthly_ranks = (monthly_ranks * (36 // len(monthly_ranks) + 1))[:36]
                else:
                    monthly_ranks = [idx] * 36

            result.append({
                "rank": idx,
                "artist_name": artist_name,
                "total_streams": row.total_streams,
                "total_minutes": round(row.total_ms / (1000 * 60), 2),
                "monthly_ranks": monthly_ranks,
            })
        return result

    data = await run_in_threadpool(query)
    return {
        "status": "ok",
        "data": data,
    }


@app.get("/api/metrics/track-rank")
async def get_track_rank(
    request: Request,
    limit: int = 10,
    conn: Connection = Depends(get_db),
):
    def query():
        history = table_registry.get_history_table(request.app.state.engine)
        stmt = (
            select(
                history.c.track_name,
                history.c.artist_name,
                func.count().label("total_streams"),
                func.coalesce(func.sum(history.c.ms_played), 0).label("total_ms"),
            )
            .where(history.c.track_name.isnot(None))
            .group_by(history.c.track_name, history.c.artist_name)
            .order_by(func.coalesce(func.sum(history.c.ms_played), 0).desc(), func.count().desc())
            .limit(limit)
        )
        rows = conn.execute(stmt).fetchall()

        raw_con = conn.connection.driver_connection
        try:
            monthly_rows = raw_con.execute("""
                SELECT 
                    track_name,
                    artist_name,
                    date_trunc('month', ts) as month,
                    SUM(ms_played) as ms
                FROM history
                WHERE track_name IS NOT NULL AND ts IS NOT NULL
                GROUP BY track_name, artist_name, month
            """).fetchall()
        except Exception:
            monthly_rows = []

        months_set = sorted({row[2] for row in monthly_rows})
        track_month_ms = {}
        for track, artist, month, ms in monthly_rows:
            key = (track, artist)
            if key not in track_month_ms:
                track_month_ms[key] = {}
            track_month_ms[key][month] = ms

        result = []
        for idx, row in enumerate(rows, start=1):
            t_key = (row.track_name, row.artist_name)
            monthly_ranks = []
            if months_set:
                for month in months_set:
                    m_scores = [(tk, m_dict.get(month, 0)) for tk, m_dict in track_month_ms.items()]
                    m_scores.sort(key=lambda x: x[1], reverse=True)
                    m_rank = 8
                    for r_idx, (tk, score) in enumerate(m_scores, start=1):
                        if tk == t_key:
                            m_rank = r_idx
                            break
                    monthly_ranks.append(min(m_rank, 8))

            if len(monthly_ranks) < 36:
                if monthly_ranks:
                    monthly_ranks = (monthly_ranks * (36 // len(monthly_ranks) + 1))[:36]
                else:
                    monthly_ranks = [idx] * 36

            result.append({
                "rank": idx,
                "track_name": row.track_name,
                "artist_name": row.artist_name,
                "total_streams": row.total_streams,
                "total_minutes": round(row.total_ms / (1000 * 60), 2),
                "monthly_ranks": monthly_ranks,
            })
        return result

    data = await run_in_threadpool(query)
    return {
        "status": "ok",
        "data": data,
    }