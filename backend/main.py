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


def _generate_month_sequence(start_str: str, end_str: str) -> list[str]:
    try:
        start_y, start_m = int(start_str[:4]), int(start_str[5:7])
        end_y, end_m = int(end_str[:4]), int(end_str[5:7])
    except Exception:
        return []
    months = []
    curr_y, curr_m = start_y, start_m
    while (curr_y < end_y) or (curr_y == end_y and curr_m <= end_m):
        months.append(f"{curr_y:04d}-{curr_m:02d}")
        curr_m += 1
        if curr_m > 12:
            curr_m = 1
            curr_y += 1
    return months


@app.get("/api/metrics/artist-rank")
async def get_artist_rank(
    request: Request,
    limit: int = 10,
    conn: Connection = Depends(get_db),
):
    def query():
        raw_con = conn.connection.driver_connection
        try:
            monthly_data = raw_con.execute("""
                SELECT 
                    date_trunc('month', ts) as month,
                    artist_name,
                    SUM(ms_played) as ms,
                    COUNT(*) as streams
                FROM history
                WHERE artist_name IS NOT NULL AND ts IS NOT NULL
                GROUP BY date_trunc('month', ts), artist_name
                ORDER BY month ASC, ms DESC, streams DESC
            """).fetchall()
        except Exception:
            monthly_data = []

        if not monthly_data:
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
            return {
                "start_month": None,
                "end_month": None,
                "total_months": 0,
                "months": [],
                "data": [
                    {
                        "rank": idx,
                        "artist_name": row.artist_name,
                        "total_streams": row.total_streams,
                        "total_minutes": round(row.total_ms / 60000, 2),
                        "monthly_ranks": [],
                    }
                    for idx, row in enumerate(rows, start=1)
                ],
            }

        # Group raw data by month
        month_groups = {}
        for month, artist, ms, streams in monthly_data:
            m_key = str(month)[:7]
            if m_key not in month_groups:
                month_groups[m_key] = []
            month_groups[m_key].append((artist, ms, streams))

        sorted_months = sorted(month_groups.keys())
        start_month = sorted_months[0]
        end_month = sorted_months[-1]
        full_months = _generate_month_sequence(start_month, end_month)

        # Step 1: Pick the featured artists by OVERALL lifetime ms_played
        # (not by first-seen order). This ensures we track the truly top artists.
        history = table_registry.get_history_table(request.app.state.engine)
        stmt = (
            select(
                history.c.artist_name,
                func.count().label("total_streams"),
                func.coalesce(func.sum(history.c.ms_played), 0).label("total_ms"),
            )
            .where(history.c.artist_name.isnot(None))
            .group_by(history.c.artist_name)
            .order_by(func.coalesce(func.sum(history.c.ms_played), 0).desc())
            .limit(limit)
        )
        top_rows = conn.execute(stmt).fetchall()
        all_featured = [r.artist_name for r in top_rows]
        overall_stats = {r.artist_name: (r.total_streams, r.total_ms) for r in top_rows}

        # Step 2: For each month, rank featured artists RELATIVE TO EACH OTHER
        # by that month's ms_played. Artists with zero plays drop off-chart.
        off_chart = limit + 1
        featured_set = set(all_featured)

        # Build per-month ms lookup for featured artists only
        month_featured_ms = {}  # m_key -> {artist_name: ms}
        for m_key in full_months:
            featured_ms = {}
            if m_key in month_groups:
                for a_name, ms, streams in month_groups[m_key]:
                    if a_name in featured_set:
                        featured_ms[a_name] = ms
            month_featured_ms[m_key] = featured_ms

        # For each month, sort featured artists by ms and assign relative ranks
        month_rank_map = {}  # m_key -> {artist_name: rank}
        for m_key in full_months:
            featured_ms = month_featured_ms[m_key]
            # Sort featured artists who had plays this month by ms DESC
            active = sorted(
                [(a, ms) for a, ms in featured_ms.items() if ms > 0],
                key=lambda x: x[1],
                reverse=True,
            )
            ranks = {}
            for rank_pos, (a_name, _) in enumerate(active, start=1):
                ranks[a_name] = rank_pos
            month_rank_map[m_key] = ranks

        result_data = []
        for idx, artist_name in enumerate(all_featured, start=1):
            monthly_ranks = []
            for m_key in full_months:
                ranks = month_rank_map[m_key]
                monthly_ranks.append(ranks.get(artist_name, off_chart))

            streams, total_ms = overall_stats.get(artist_name, (0, 0))
            result_data.append({
                "rank": idx,
                "artist_name": artist_name,
                "total_streams": streams,
                "total_minutes": round(total_ms / 60000, 2),
                "monthly_ranks": monthly_ranks,
            })

        return {
            "start_month": start_month,
            "end_month": end_month,
            "total_months": len(full_months),
            "months": full_months,
            "data": result_data,
        }

    res = await run_in_threadpool(query)
    return {
        "status": "ok",
        "start_month": res["start_month"],
        "end_month": res["end_month"],
        "total_months": res["total_months"],
        "months": res["months"],
        "data": res["data"],
    }


@app.get("/api/metrics/track-rank")
async def get_track_rank(
    request: Request,
    limit: int = 10,
    conn: Connection = Depends(get_db),
):
    def query():
        raw_con = conn.connection.driver_connection
        try:
            monthly_data = raw_con.execute("""
                SELECT 
                    date_trunc('month', ts) as month,
                    track_name,
                    artist_name,
                    SUM(ms_played) as ms,
                    COUNT(*) as streams
                FROM history
                WHERE track_name IS NOT NULL AND ts IS NOT NULL
                GROUP BY date_trunc('month', ts), track_name, artist_name
                ORDER BY month ASC, ms DESC, streams DESC
            """).fetchall()
        except Exception:
            monthly_data = []

        if not monthly_data:
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
            return {
                "start_month": None,
                "end_month": None,
                "total_months": 0,
                "months": [],
                "data": [
                    {
                        "rank": idx,
                        "track_name": row.track_name,
                        "artist_name": row.artist_name,
                        "total_streams": row.total_streams,
                        "total_minutes": round(row.total_ms / 60000, 2),
                        "monthly_ranks": [],
                    }
                    for idx, row in enumerate(rows, start=1)
                ],
            }

        month_groups = {}
        for month, track, artist, ms, streams in monthly_data:
            m_key = str(month)[:7]
            if m_key not in month_groups:
                month_groups[m_key] = []
            month_groups[m_key].append(((track, artist), ms, streams))

        sorted_months = sorted(month_groups.keys())
        start_month = sorted_months[0]
        end_month = sorted_months[-1]
        full_months = _generate_month_sequence(start_month, end_month)

        # Step 1: Pick the featured tracks by OVERALL lifetime ms_played
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
            .order_by(func.coalesce(func.sum(history.c.ms_played), 0).desc())
            .limit(limit)
        )
        top_rows = conn.execute(stmt).fetchall()
        all_featured = [(r.track_name, r.artist_name) for r in top_rows]
        overall_stats = {
            (r.track_name, r.artist_name): (r.total_streams, r.total_ms)
            for r in top_rows
        }

        # Step 2: For each month, rank featured tracks RELATIVE TO EACH OTHER
        # by that month's ms_played. Tracks with zero plays drop off-chart.
        off_chart = limit + 1
        featured_set = set(all_featured)

        # Build per-month ms lookup for featured tracks only
        month_featured_ms = {}  # m_key -> {(track, artist): ms}
        for m_key in full_months:
            featured_ms = {}
            if m_key in month_groups:
                for t_pair, ms, streams in month_groups[m_key]:
                    if t_pair in featured_set:
                        featured_ms[t_pair] = ms
            month_featured_ms[m_key] = featured_ms

        # For each month, sort featured tracks by ms and assign relative ranks
        month_rank_map = {}  # m_key -> {(track, artist): rank}
        for m_key in full_months:
            featured_ms = month_featured_ms[m_key]
            active = sorted(
                [(p, ms) for p, ms in featured_ms.items() if ms > 0],
                key=lambda x: x[1],
                reverse=True,
            )
            ranks = {}
            for rank_pos, (t_pair, _) in enumerate(active, start=1):
                ranks[t_pair] = rank_pos
            month_rank_map[m_key] = ranks

        result_data = []
        for idx, (track_name, artist_name) in enumerate(all_featured, start=1):
            pair = (track_name, artist_name)
            monthly_ranks = []
            for m_key in full_months:
                ranks = month_rank_map[m_key]
                monthly_ranks.append(ranks.get(pair, off_chart))

            streams, total_ms = overall_stats.get(pair, (0, 0))
            result_data.append({
                "rank": idx,
                "track_name": track_name,
                "artist_name": artist_name,
                "total_streams": streams,
                "total_minutes": round(total_ms / 60000, 2),
                "monthly_ranks": monthly_ranks,
            })

        return {
            "start_month": start_month,
            "end_month": end_month,
            "total_months": len(full_months),
            "months": full_months,
            "data": result_data,
        }

    res = await run_in_threadpool(query)
    return {
        "status": "ok",
        "start_month": res["start_month"],
        "end_month": res["end_month"],
        "total_months": res["total_months"],
        "months": res["months"],
        "data": res["data"],
    }