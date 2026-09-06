"""Overview-page metrics: totals, top artist/album/track, songs, active day, heatmap."""

from database import get_db, table_registry
from fastapi import APIRouter, Depends, Request
from metrics import (
    _heatmap_level,
    _heatmap_thresholds,
    _tz_offset_minutes,
    _WEEKDAY_NAMES,
)
from sqlalchemy import func, select
from sqlalchemy.engine import Connection
from starlette.concurrency import run_in_threadpool

router = APIRouter()


def _lookup_scalar(conn: Connection, sql: str, params: list) -> str | None:
    """Best-effort single-value lookup on the raw connection; None on any failure."""
    try:
        row = conn.connection.driver_connection.execute(sql, params).fetchone()
        return row[0] if row and row[0] else None
    except Exception:
        return None


@router.get("/api/metrics/total-time")
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


@router.get("/api/metrics/top-artist")
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


@router.get("/api/metrics/top-album")
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


@router.get("/api/metrics/top-track")
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


@router.get("/api/metrics/heatmap")
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
        off = _tz_offset_minutes(raw_con)  # int minutes; safe to inline
        try:
            year_rows = raw_con.execute(
                f"SELECT DISTINCT EXTRACT(year FROM ts + to_minutes({off}))::INTEGER AS y "
                "FROM history WHERE ts IS NOT NULL ORDER BY y"
            ).fetchall()
        except Exception:
            year_rows = []
        years = [r[0] for r in year_rows]

        if not years:
            return {"years": [], "year": None, "days": []}

        target = year if year in years else years[-1]

        daily = raw_con.execute(
            f"SELECT CAST(ts + to_minutes({off}) AS DATE) AS day, COUNT(*) AS streams, "
            "COALESCE(SUM(ms_played), 0) AS ms "
            "FROM history "
            f"WHERE ts IS NOT NULL AND EXTRACT(year FROM ts + to_minutes({off})) = ? "
            f"GROUP BY CAST(ts + to_minutes({off}) AS DATE) ORDER BY day",
            [target],
        ).fetchall()

        top_map: dict[str, tuple] = {}
        try:
            for r in raw_con.execute(
                "SELECT day, track_name, artist_name FROM ("
                f"  SELECT CAST(ts + to_minutes({off}) AS DATE) AS day, track_name, artist_name, "
                "         ROW_NUMBER() OVER ("
                f"           PARTITION BY CAST(ts + to_minutes({off}) AS DATE) "
                "           ORDER BY COUNT(*) DESC, SUM(ms_played) DESC"
                "         ) AS rn "
                "  FROM history "
                "  WHERE ts IS NOT NULL AND track_name IS NOT NULL "
                f"        AND EXTRACT(year FROM ts + to_minutes({off})) = ? "
                f"  GROUP BY CAST(ts + to_minutes({off}) AS DATE), track_name, artist_name"
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


@router.get("/api/metrics/total-songs")
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


@router.get("/api/metrics/active-day")
async def get_active_day(
    request: Request,
    conn: Connection = Depends(get_db),
):
    """Weekday with the most listening, plus average listening per that weekday."""

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con)  # int minutes; safe to inline
        try:
            return raw_con.execute(
                f"SELECT EXTRACT(isodow FROM ts + to_minutes({off})) AS dow, "
                "       COALESCE(SUM(ms_played), 0) AS ms, "
                f"       COUNT(DISTINCT CAST(ts + to_minutes({off}) AS DATE)) AS days "
                "FROM history WHERE ts IS NOT NULL "
                f"GROUP BY EXTRACT(isodow FROM ts + to_minutes({off})) "
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
