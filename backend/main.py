import os
import shutil
import tempfile

import catalog
import images
from database import get_db, lifespan as database_lifespan, table_registry
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.engine import Connection
from starlette.concurrency import run_in_threadpool

app = FastAPI(title="Rewind API", lifespan=database_lifespan)

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


def _enrich_session(conn: Connection) -> dict:
    """Materialize the track_features slice by joining history against the catalog."""
    result = catalog.enrich_session(conn.connection.driver_connection)
    conn.commit()
    return result


def _lookup_scalar(conn: Connection, sql: str, params: list) -> str | None:
    """Best-effort single-value lookup on the raw connection; None on any failure."""
    try:
        row = conn.connection.driver_connection.execute(sql, params).fetchone()
        return row[0] if row and row[0] else None
    except Exception:
        return None


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


@app.get("/api/image")
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
        row = conn.execute(stmt).first()
        artist_id = None
        if row and row.artist_name:
            artist_id = _lookup_scalar(
                conn,
                "SELECT artist_id FROM track_features "
                "WHERE artist_name = ? AND artist_id IS NOT NULL LIMIT 1",
                [row.artist_name],
            )
        return row, artist_id

    row, artist_id = await run_in_threadpool(query)

    if not row:
        return {
            "status": "ok",
            "artist_name": None,
            "total_streams": 0,
            "total_minutes": 0,
            "artist_id": None,
        }

    return {
        "status": "ok",
        "artist_name": row.artist_name,
        "total_streams": row.total_streams,
        "total_minutes": round(row.total_ms / (1000 * 60), 2),
        "artist_id": artist_id,
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
        row = conn.execute(stmt).first()
        album_id = None
        if row and row.album_name:
            album_id = _lookup_scalar(
                conn,
                "SELECT album_id FROM track_features "
                "WHERE album_name = ? AND artist_name = ? AND album_id IS NOT NULL LIMIT 1",
                [row.album_name, row.artist_name],
            )
        return row, album_id

    row, album_id = await run_in_threadpool(query)

    if not row:
        return {
            "status": "ok",
            "album_name": None,
            "artist_name": None,
            "total_streams": 0,
            "total_minutes": 0,
            "album_id": None,
        }

    return {
        "status": "ok",
        "album_name": row.album_name,
        "artist_name": row.artist_name,
        "total_streams": row.total_streams,
        "total_minutes": round(row.total_ms / (1000 * 60), 2),
        "album_id": album_id,
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
        row = conn.execute(stmt).first()
        track_id = None
        if row and row.track_name:
            track_id = _lookup_scalar(
                conn,
                "SELECT replace(track_uri, 'spotify:track:', '') FROM history "
                "WHERE track_name = ? AND artist_name = ? "
                "AND track_uri LIKE 'spotify:track:%' LIMIT 1",
                [row.track_name, row.artist_name],
            )
        return row, track_id

    row, track_id = await run_in_threadpool(query)

    if not row:
        return {
            "status": "ok",
            "track_name": None,
            "artist_name": None,
            "total_streams": 0,
            "total_minutes": 0,
            "track_id": None,
        }

    return {
        "status": "ok",
        "track_name": row.track_name,
        "artist_name": row.artist_name,
        "total_streams": row.total_streams,
        "total_minutes": round(row.total_ms / (1000 * 60), 2),
        "track_id": track_id,
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


def _hysteresis_reorder(prev_order: list, scores: dict, margin: float) -> list:
    """Re-sort by score but only swap neighbours when the lower-positioned item
    beats the higher by more than ``margin`` (relative). Suppresses near-tie flicker."""
    order = list(prev_order)
    swapped = True
    while swapped:
        swapped = False
        for i in range(len(order) - 1):
            hi, lo = order[i], order[i + 1]
            if scores[lo] > scores[hi] * (1 + margin):
                order[i], order[i + 1] = lo, hi
                swapped = True
    return order


def _smoothed_rank_frames(
    monthly_rows: list,
    key_len: int,
    limit: int,
    alpha: float = 0.3,
    hysteresis: float = 0.12,
):
    """Rank Velocity signal: EWMA score + fixed Top-N cohort + hysteresis.

    ``monthly_rows`` are ``(month, *key_cols, ms, streams)``. Returns
    ``(full_months, featured)`` where ``featured`` is ordered by lifetime ms and
    each item is ``{key, total_ms, total_streams, monthly_ranks}``.
    """
    month_map: dict[str, dict] = {}
    lifetime: dict[tuple, list] = {}
    for row in monthly_rows:
        m_key = str(row[0])[:7]
        key = tuple(row[1 : 1 + key_len])
        ms = row[1 + key_len] or 0
        streams = row[2 + key_len] or 0
        slot = month_map.setdefault(m_key, {}).setdefault(key, [0, 0])
        slot[0] += ms
        slot[1] += streams
        life = lifetime.setdefault(key, [0, 0])
        life[0] += ms
        life[1] += streams

    if not month_map:
        return [], []

    sorted_months = sorted(month_map.keys())
    full_months = (
        _generate_month_sequence(sorted_months[0], sorted_months[-1]) or sorted_months
    )

    # Fixed Top-N cohort chosen once over the whole period (by lifetime ms).
    cohort = sorted(lifetime, key=lambda k: lifetime[k][0], reverse=True)[:limit]

    ewma = {k: 0.0 for k in cohort}
    monthly_ranks: dict[tuple, list] = {k: [] for k in cohort}
    order = None
    for m_key in full_months:
        month_data = month_map.get(m_key, {})
        for k in cohort:
            ms = month_data.get(k, (0, 0))[0]
            ewma[k] = alpha * ms + (1 - alpha) * ewma[k]
        if order is None:
            order = sorted(cohort, key=lambda k: (ewma[k], lifetime[k][0]), reverse=True)
        else:
            order = _hysteresis_reorder(order, ewma, hysteresis)
        for pos, k in enumerate(order, start=1):
            monthly_ranks[k].append(pos)

    featured = sorted(cohort, key=lambda k: lifetime[k][0], reverse=True)
    return full_months, [
        {
            "key": k,
            "total_ms": lifetime[k][0],
            "total_streams": lifetime[k][1],
            "monthly_ranks": monthly_ranks[k],
        }
        for k in featured
    ]


def _compute_bar_race(monthly_rows: list, key_len: int, limit: int):
    """All-time bar race signal: running SUM(ms) per entity across months.

    ``monthly_rows`` are ``(month, *key_cols, ms)``. Returns
    ``(full_months, featured)`` where ``featured`` holds every entity that ever
    reaches the top ``limit`` in any frame, ordered by final cumulative total,
    each ``{key, total_ms, cumulative_ms}``.
    """
    month_map: dict[str, dict] = {}
    lifetime: dict[tuple, int] = {}
    for row in monthly_rows:
        m_key = str(row[0])[:7]
        key = tuple(row[1 : 1 + key_len])
        ms = row[1 + key_len] or 0
        mm = month_map.setdefault(m_key, {})
        mm[key] = mm.get(key, 0) + ms
        lifetime[key] = lifetime.get(key, 0) + ms

    if not month_map:
        return [], []

    sorted_months = sorted(month_map.keys())
    full_months = (
        _generate_month_sequence(sorted_months[0], sorted_months[-1]) or sorted_months
    )

    cumulative: dict[tuple, list] = {k: [] for k in lifetime}
    running: dict[tuple, int] = {k: 0 for k in lifetime}
    featured: set = set()
    for m_key in full_months:
        month_data = month_map.get(m_key, {})
        for k in lifetime:
            running[k] += month_data.get(k, 0)
            cumulative[k].append(running[k])
        frame_top = sorted(lifetime, key=lambda k: running[k], reverse=True)[:limit]
        featured.update(frame_top)

    ordered = sorted(featured, key=lambda k: lifetime[k], reverse=True)
    return full_months, [
        {"key": k, "total_ms": lifetime[k], "cumulative_ms": cumulative[k]}
        for k in ordered
    ]


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

        full_months, featured = _smoothed_rank_frames(
            monthly_data, key_len=1, limit=limit
        )
        data = [
            {
                "rank": idx,
                "artist_name": f["key"][0],
                "total_streams": f["total_streams"],
                "total_minutes": round(f["total_ms"] / 60000, 2),
                "monthly_ranks": f["monthly_ranks"],
            }
            for idx, f in enumerate(featured, start=1)
        ]
        return {
            "start_month": full_months[0] if full_months else None,
            "end_month": full_months[-1] if full_months else None,
            "total_months": len(full_months),
            "months": full_months,
            "data": data,
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

        full_months, featured = _smoothed_rank_frames(
            monthly_data, key_len=2, limit=limit
        )
        data = [
            {
                "rank": idx,
                "track_name": f["key"][0],
                "artist_name": f["key"][1],
                "total_streams": f["total_streams"],
                "total_minutes": round(f["total_ms"] / 60000, 2),
                "monthly_ranks": f["monthly_ranks"],
            }
            for idx, f in enumerate(featured, start=1)
        ]
        return {
            "start_month": full_months[0] if full_months else None,
            "end_month": full_months[-1] if full_months else None,
            "total_months": len(full_months),
            "months": full_months,
            "data": data,
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


@app.get("/api/metrics/bar-race")
async def get_bar_race(
    request: Request,
    entity: str = "artist",
    limit: int = 12,
    conn: Connection = Depends(get_db),
):
    """Cumulative-listening bar race frames for artist / track / album."""
    entity = entity.lower()
    specs = {
        "artist": ("artist_name", 1),
        "track": ("track_name, artist_name", 2),
        "album": ("album_name, artist_name", 2),
    }
    if entity not in specs:
        raise HTTPException(status_code=400, detail="Invalid entity for bar race.")
    cols, key_len = specs[entity]
    name_col = cols.split(",")[0].strip()

    def query():
        raw_con = conn.connection.driver_connection
        try:
            rows = raw_con.execute(
                f"""
                SELECT date_trunc('month', ts) AS month, {cols}, SUM(ms_played) AS ms
                FROM history
                WHERE {name_col} IS NOT NULL AND ts IS NOT NULL
                GROUP BY date_trunc('month', ts), {cols}
                """
            ).fetchall()
        except Exception:
            rows = []

        full_months, featured = _compute_bar_race(rows, key_len, limit)
        data = []
        for idx, f in enumerate(featured, start=1):
            item = {
                "rank": idx,
                "name": f["key"][0],
                "total_minutes": round(f["total_ms"] / 60000, 2),
                "cumulative_minutes": [
                    round(v / 60000, 2) for v in f["cumulative_ms"]
                ],
            }
            if key_len == 2:
                item["artist_name"] = f["key"][1]
            data.append(item)

        return {
            "start_month": full_months[0] if full_months else None,
            "end_month": full_months[-1] if full_months else None,
            "total_months": len(full_months),
            "months": full_months,
            "data": data,
        }

    res = await run_in_threadpool(query)
    return {"status": "ok", "entity": entity, "unit": "minutes", **res}