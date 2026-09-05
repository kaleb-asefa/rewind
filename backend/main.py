import os
import shutil
import tempfile
from datetime import date, timedelta

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
            .order_by(func.coalesce(func.sum(history.c.ms_played), 0).desc())
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


def _generate_week_sequence(start_str: str, end_str: str) -> list[str]:
    """All ISO week-start dates (inclusive) between two ``date_trunc('week')`` values."""
    try:
        start = date.fromisoformat(start_str[:10])
        end = date.fromisoformat(end_str[:10])
    except Exception:
        return []
    weeks = []
    cur = start
    while cur <= end:
        weeks.append(cur.isoformat())
        cur += timedelta(days=7)
    return weeks


def _smoothed_rank_frames(
    monthly_rows: list,
    key_len: int,
    limit: int,
    alpha: float = 0.35,
    hysteresis: float = 0.1,
):
    """Rank Velocity signal: EWMA-smoothed monthly score with genuine enter/leave.

    Each entity's score is an exponentially weighted moving average of monthly
    listening time, so a few heavy months build a peak that then fades once
    listening stops — capturing the rise and *flop* of temporary obsessions
    rather than only the all-time top N. Every month keeps the top ``limit`` by
    that smoothed score (entities below fall "off-chart" at rank ``limit + 1``);
    a small relegation margin stops a line blinking in and out at the boundary.

    ``monthly_rows`` are ``(month, *key_cols, ms, streams)``. Returns
    ``(full_months, featured)`` where ``featured`` is every entity that ever
    reaches the top ``limit``, ordered by lifetime ms, each
    ``{key, total_ms, total_streams, monthly_ranks}``.
    """
    month_map: dict[str, dict] = {}
    lifetime: dict[tuple, list] = {}
    for row in monthly_rows:
        m_key = str(row[0])[:10]
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
        _generate_week_sequence(sorted_months[0], sorted_months[-1]) or sorted_months
    )

    entities = list(lifetime.keys())
    ewma = {k: 0.0 for k in entities}
    off_chart = limit + 1
    monthly_top: list[list] = []  # ordered top-`limit` keys per month
    featured_set: set = set()
    prev_visible: set = set()

    for m_key in full_months:
        month_data = month_map.get(m_key, {})
        for k in entities:
            ewma[k] = alpha * month_data.get(k, (0, 0))[0] + (1 - alpha) * ewma[k]

        # Only entities actually played by now compete; EWMA carries (decaying)
        # memory forward, so an artist stays eligible after their first listen and
        # only drops off when others outrank them.
        active = [k for k in entities if ewma[k] > 1e-9]
        ranked = sorted(active, key=lambda k: (ewma[k], lifetime[k][0]), reverse=True)
        top = ranked[:limit]

        # Relegation hysteresis: if the weakest newcomer only barely edged out an
        # incumbent sitting right below the line, keep the incumbent instead.
        if prev_visible and len(ranked) > limit:
            weakest_in = ranked[limit - 1]
            strongest_out = ranked[limit]
            if (
                strongest_out in prev_visible
                and weakest_in not in prev_visible
                and ewma[weakest_in] < ewma[strongest_out] * (1 + hysteresis)
            ):
                top[limit - 1] = strongest_out
                top.sort(key=lambda k: (ewma[k], lifetime[k][0]), reverse=True)

        prev_visible = set(top)
        monthly_top.append(top)
        featured_set.update(top)

    featured = sorted(featured_set, key=lambda k: lifetime[k][0], reverse=True)
    result = []
    for k in featured:
        ranks = [top.index(k) + 1 if k in top else off_chart for top in monthly_top]
        result.append(
            {
                "key": k,
                "total_ms": lifetime[k][0],
                "total_streams": lifetime[k][1],
                "monthly_ranks": ranks,
            }
        )
    return full_months, result


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
                    date_trunc('week', ts) as period,
                    artist_name,
                    SUM(ms_played) as ms,
                    COUNT(*) as streams
                FROM history
                WHERE artist_name IS NOT NULL AND ts IS NOT NULL
                GROUP BY date_trunc('week', ts), artist_name
                ORDER BY period ASC, ms DESC, streams DESC
            """).fetchall()
        except Exception:
            monthly_data = []

        full_months, featured = _smoothed_rank_frames(
            monthly_data, key_len=1, limit=limit
        )
        id_map: dict = {}
        try:
            for r in raw_con.execute(
                "SELECT artist_name, MAX(artist_id) FROM track_features "
                "WHERE artist_id IS NOT NULL GROUP BY artist_name"
            ).fetchall():
                id_map[(r[0],)] = r[1]
        except Exception:
            id_map = {}
        data = [
            {
                "rank": idx,
                "artist_name": f["key"][0],
                "id": id_map.get(f["key"]),
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
                    date_trunc('week', ts) as period,
                    track_name,
                    artist_name,
                    SUM(ms_played) as ms,
                    COUNT(*) as streams
                FROM history
                WHERE track_name IS NOT NULL AND ts IS NOT NULL
                GROUP BY date_trunc('week', ts), track_name, artist_name
                ORDER BY period ASC, ms DESC, streams DESC
            """).fetchall()
        except Exception:
            monthly_data = []

        full_months, featured = _smoothed_rank_frames(
            monthly_data, key_len=2, limit=limit
        )
        id_map: dict = {}
        try:
            for r in raw_con.execute(
                "SELECT track_name, artist_name, "
                "MAX(replace(track_uri, 'spotify:track:', '')) FROM history "
                "WHERE track_uri LIKE 'spotify:track:%' GROUP BY track_name, artist_name"
            ).fetchall():
                id_map[(r[0], r[1])] = r[2]
        except Exception:
            id_map = {}
        data = [
            {
                "rank": idx,
                "track_name": f["key"][0],
                "artist_name": f["key"][1],
                "id": id_map.get(f["key"]),
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

        # Best-effort id lookup so the frontend can lazy-load cover art.
        id_map: dict = {}
        try:
            if entity == "artist":
                for r in raw_con.execute(
                    "SELECT artist_name, MAX(artist_id) FROM track_features "
                    "WHERE artist_id IS NOT NULL GROUP BY artist_name"
                ).fetchall():
                    id_map[(r[0],)] = r[1]
            elif entity == "album":
                for r in raw_con.execute(
                    "SELECT album_name, artist_name, MAX(album_id) FROM track_features "
                    "WHERE album_id IS NOT NULL GROUP BY album_name, artist_name"
                ).fetchall():
                    id_map[(r[0], r[1])] = r[2]
            else:  # track
                for r in raw_con.execute(
                    "SELECT track_name, artist_name, "
                    "MAX(replace(track_uri, 'spotify:track:', '')) FROM history "
                    "WHERE track_uri LIKE 'spotify:track:%' GROUP BY track_name, artist_name"
                ).fetchall():
                    id_map[(r[0], r[1])] = r[2]
        except Exception:
            id_map = {}

        data = []
        for idx, f in enumerate(featured, start=1):
            item = {
                "rank": idx,
                "name": f["key"][0],
                "id": id_map.get(f["key"]),
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


def _heatmap_thresholds(counts: list[int]) -> list[int]:
    """Ascending level boundaries mapping a day's stream count to a 1-4 intensity.

    Uses quartiles of the active-day distribution so the colour ramp adapts to
    each listener instead of assuming fixed stream volumes.
    """
    ordered = sorted(c for c in counts if c > 0)
    if not ordered:
        return []
    n = len(ordered)
    return [ordered[min(n - 1, int(p * n))] for p in (0.25, 0.5, 0.75)]


def _heatmap_level(count: int, thresholds: list[int]) -> int:
    if count <= 0:
        return 0
    if not thresholds:
        return 1
    for level, bound in enumerate(thresholds, start=1):
        if count <= bound:
            return level
    return 4


@app.get("/api/metrics/heatmap")
async def get_heatmap(
    request: Request,
    year: int | None = None,
    conn: Connection = Depends(get_db),
):
    """Daily listening activity for a GitHub-style calendar heatmap.

    Returns every year present in the history plus, for the requested year
    (default: most recent), one entry per active day with its stream count,
    minutes listened, an adaptive intensity level, and that day's top track.
    """

    def query():
        raw_con = conn.connection.driver_connection
        try:
            year_rows = raw_con.execute(
                "SELECT DISTINCT EXTRACT(year FROM ts)::INTEGER AS y "
                "FROM history WHERE ts IS NOT NULL ORDER BY y"
            ).fetchall()
        except Exception:
            year_rows = []
        years = [r[0] for r in year_rows]

        if not years:
            return {"years": [], "year": None, "days": []}

        target = year if year in years else years[-1]

        daily = raw_con.execute(
            "SELECT CAST(ts AS DATE) AS day, COUNT(*) AS streams, "
            "COALESCE(SUM(ms_played), 0) AS ms "
            "FROM history "
            "WHERE ts IS NOT NULL AND EXTRACT(year FROM ts) = ? "
            "GROUP BY CAST(ts AS DATE) ORDER BY day",
            [target],
        ).fetchall()

        top_map: dict[str, tuple] = {}
        try:
            for r in raw_con.execute(
                "SELECT day, track_name, artist_name FROM ("
                "  SELECT CAST(ts AS DATE) AS day, track_name, artist_name, "
                "         ROW_NUMBER() OVER ("
                "           PARTITION BY CAST(ts AS DATE) "
                "           ORDER BY COUNT(*) DESC, SUM(ms_played) DESC"
                "         ) AS rn "
                "  FROM history "
                "  WHERE ts IS NOT NULL AND track_name IS NOT NULL "
                "        AND EXTRACT(year FROM ts) = ? "
                "  GROUP BY CAST(ts AS DATE), track_name, artist_name"
                ") t WHERE rn = 1",
                [target],
            ).fetchall():
                top_map[str(r[0])] = (r[1], r[2])
        except Exception:
            top_map = {}

        counts = [row[1] for row in daily]
        thresholds = _heatmap_thresholds(counts)

        days = []
        total_streams = 0
        total_ms = 0
        for day, streams, ms in daily:
            iso = str(day)
            total_streams += streams
            total_ms += ms
            top = top_map.get(iso)
            days.append(
                {
                    "date": iso,
                    "streams": streams,
                    "minutes": round(ms / 60000, 2),
                    "level": _heatmap_level(streams, thresholds),
                    "top_track": top[0] if top else None,
                    "top_artist": top[1] if top else None,
                }
            )

        return {
            "years": years,
            "year": target,
            "active_days": len(days),
            "total_streams": total_streams,
            "total_minutes": round(total_ms / 60000, 2),
            "max_streams": max(counts) if counts else 0,
            "days": days,
        }

    res = await run_in_threadpool(query)
    return {"status": "ok", **res}


@app.get("/api/metrics/total-songs")
async def get_total_songs(
    request: Request,
    conn: Connection = Depends(get_db),
):
    """Number of distinct Spotify tracks in the listening history."""

    def query():
        raw_con = conn.connection.driver_connection
        try:
            row = raw_con.execute(
                "SELECT COUNT(DISTINCT track_uri) FROM history "
                "WHERE track_uri LIKE 'spotify:track:%'"
            ).fetchone()
        except Exception:
            row = None
        return int(row[0]) if row and row[0] else 0

    total_songs = await run_in_threadpool(query)
    return {"status": "ok", "total_songs": total_songs}


_WEEKDAY_NAMES = {
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
    7: "Sunday",
}


@app.get("/api/metrics/active-day")
async def get_active_day(
    request: Request,
    conn: Connection = Depends(get_db),
):
    """Weekday with the most listening, plus average listening per that weekday."""

    def query():
        raw_con = conn.connection.driver_connection
        try:
            return raw_con.execute(
                "SELECT EXTRACT(isodow FROM ts) AS dow, "
                "       COALESCE(SUM(ms_played), 0) AS ms, "
                "       COUNT(DISTINCT CAST(ts AS DATE)) AS days "
                "FROM history WHERE ts IS NOT NULL "
                "GROUP BY EXTRACT(isodow FROM ts) "
                "ORDER BY ms DESC"
            ).fetchall()
        except Exception:
            return []

    rows = await run_in_threadpool(query)
    if not rows:
        return {
            "status": "ok",
            "weekday": None,
            "average_minutes": 0,
            "total_minutes": 0,
        }

    dow, ms, days = rows[0]
    avg_ms = (ms / days) if days else 0
    return {
        "status": "ok",
        "weekday": _WEEKDAY_NAMES.get(int(dow)),
        "average_minutes": round(avg_ms / 60000, 2),
        "total_minutes": round(ms / 60000, 2),
    }


def _listening_streaks(days: list) -> dict:
    """Longest and latest consecutive-day streaks from sorted distinct dates."""
    if not days:
        return {"longest": 0, "current": 0, "active_days": 0}
    longest = run = 1
    for i in range(1, len(days)):
        run = run + 1 if (days[i] - days[i - 1]).days == 1 else 1
        longest = max(longest, run)
    latest = 1
    for i in range(len(days) - 1, 0, -1):
        if (days[i] - days[i - 1]).days == 1:
            latest += 1
        else:
            break
    return {"longest": longest, "current": latest, "active_days": len(days)}


def _chronotype(hourly: list[int]) -> dict:
    """Early-bird ↔ night-owl position (0..1) from the hourly play distribution.

    Hours are shifted so the listening day starts at 5AM, then a play-weighted
    average is mapped onto 0 (early riser) .. 1 (deep night owl).
    """
    total = sum(hourly)
    if total == 0:
        return {"label": None, "position": 0.0}
    weighted = sum(((h - 5) % 24) * c for h, c in enumerate(hourly))
    position = max(0.0, min(1.0, (weighted / total) / 23))
    if position < 0.34:
        label = "Early bird"
    elif position < 0.6:
        label = "Balanced"
    else:
        label = "Night owl"
    return {"label": label, "position": round(position, 3)}


# Spotify stores `ts` in UTC; shift by the local offset so the rhythm chapter
# reads in the listener's wall-clock time. Default = EAT (Ethiopia, UTC+3).
LOCAL_TZ_OFFSET_HOURS = int(os.getenv("REWIND_TZ_OFFSET_HOURS", "3"))


@app.get("/api/metrics/rhythm")
async def get_rhythm(
    request: Request,
    conn: Connection = Depends(get_db),
):
    """Temporal listening patterns for the "When You Listen" chapter: plays by
    hour of day, weekday and month of year, plus daily streaks and a chronotype
    score. Times are shifted from the stored UTC timestamp into local time
    (LOCAL_TZ_OFFSET_HOURS, default EAT / UTC+3) so hours read as wall-clock.
    """

    def query():
        raw_con = conn.connection.driver_connection
        off = LOCAL_TZ_OFFSET_HOURS

        def fetch(sql, params=None):
            try:
                return raw_con.execute(sql, params).fetchall() if params else raw_con.execute(sql).fetchall()
            except Exception:
                return []

        hourly = [0] * 24
        for h, c in fetch(
            "SELECT EXTRACT(hour FROM ts + to_hours(?))::INTEGER AS h, COUNT(*) "
            "FROM history WHERE ts IS NOT NULL GROUP BY h",
            [off],
        ):
            if h is not None and 0 <= int(h) <= 23:
                hourly[int(h)] = int(c)

        weekday = [0] * 7  # Mon..Sun
        for d, c in fetch(
            "SELECT EXTRACT(isodow FROM ts + to_hours(?))::INTEGER AS d, COUNT(*) "
            "FROM history WHERE ts IS NOT NULL GROUP BY d",
            [off],
        ):
            if d is not None and 1 <= int(d) <= 7:
                weekday[int(d) - 1] = int(c)

        monthly = [0] * 12  # Jan..Dec
        for m, c in fetch(
            "SELECT EXTRACT(month FROM ts + to_hours(?))::INTEGER AS m, COUNT(*) "
            "FROM history WHERE ts IS NOT NULL GROUP BY m",
            [off],
        ):
            if m is not None and 1 <= int(m) <= 12:
                monthly[int(m) - 1] = int(c)

        day_rows = fetch(
            "SELECT DISTINCT CAST(ts + to_hours(?) AS DATE) AS day FROM history "
            "WHERE ts IS NOT NULL ORDER BY day",
            [off],
        )
        days = [r[0] for r in day_rows]

        return hourly, weekday, monthly, days

    hourly, weekday, monthly, days = await run_in_threadpool(query)

    total_streams = sum(hourly)
    peak_hour = max(range(24), key=lambda i: hourly[i]) if total_streams else None
    busiest_idx = max(range(7), key=lambda i: weekday[i]) if sum(weekday) else None
    busiest_weekday = (
        _WEEKDAY_NAMES.get(busiest_idx + 1) if busiest_idx is not None else None
    )

    return {
        "status": "ok",
        "hourly": hourly,
        "peak_hour": peak_hour,
        "weekday": weekday,
        "busiest_weekday": busiest_weekday,
        "monthly": monthly,
        "chronotype": _chronotype(hourly),
        "streak": _listening_streaks(days),
        "total_streams": total_streams,
    }


@app.get("/api/metrics/audio")
async def get_audio(
    request: Request,
    conn: Connection = Depends(get_db),
):
    """Audio-feature profile for the "Your Sound" chapter, from the enriched
    track_features slice: play-weighted average mood/energy/etc., per-track
    valence/energy for the mood map, and catalog coverage. Empty when the
    track_features slice is missing (unenriched session).
    """

    _JOIN = (
        "FROM history h JOIN track_features f "
        "ON split_part(h.track_uri, ':', 3) = f.track_id "
        "WHERE h.track_uri LIKE 'spotify:track:%'"
    )

    def query():
        raw_con = conn.connection.driver_connection
        try:
            agg = raw_con.execute(
                "SELECT AVG(f.energy), AVG(f.valence), AVG(f.danceability), "
                "AVG(f.acousticness), AVG(f.instrumentalness), AVG(f.tempo), "
                "AVG(CASE WHEN f.mode = 1 THEN 1.0 ELSE 0.0 END), COUNT(*) " + _JOIN
            ).fetchone()
        except Exception:
            return None
        if not agg or not agg[7]:
            return None
        energy, valence, dance, acoustic, instr, tempo, major, matched = agg

        try:
            trows = raw_con.execute(
                "SELECT any_value(h.track_name), f.valence, f.energy, COUNT(*) AS plays "
                + _JOIN + " AND h.track_name IS NOT NULL "
                "AND f.valence IS NOT NULL AND f.energy IS NOT NULL "
                "GROUP BY f.track_id, f.valence, f.energy ORDER BY plays DESC LIMIT 24"
            ).fetchall()
        except Exception:
            trows = []

        try:
            total = raw_con.execute(
                "SELECT COUNT(*) FROM history WHERE track_uri LIKE 'spotify:track:%'"
            ).fetchone()[0]
        except Exception:
            total = 0

        return {
            "avg": {
                "energy": round(energy or 0, 3),
                "valence": round(valence or 0, 3),
                "danceability": round(dance or 0, 3),
                "acousticness": round(acoustic or 0, 3),
                "vocal": round(1 - (instr or 0), 3),
            },
            "tempo_avg": round(tempo or 0),
            "mode": {"major": round(major or 0, 3)},
            "tracks": [
                {
                    "name": r[0],
                    "valence": round(r[1], 3),
                    "energy": round(r[2], 3),
                    "plays": int(r[3]),
                }
                for r in trows
            ],
            "matched": int(matched),
            "total": int(total),
        }

    res = await run_in_threadpool(query)
    if not res:
        return {
            "status": "ok",
            "avg": None,
            "tracks": [],
            "coverage": 0.0,
            "matched": 0,
            "total": 0,
        }
    total = res["total"]
    res["coverage"] = round(res["matched"] / total, 4) if total else 0.0
    return {"status": "ok", **res}