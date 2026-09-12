"""Explore-page (deep dive) metrics: rank velocity, bar race, rhythm, audio,
taste, behavior, discovery and listening life.

Every metric endpoint here takes an optional `year` filter (`all` = default =
every play ever, or a 4-digit year); `/api/metrics/years` lists the years a
session actually has data for.
"""

import unicodedata
from datetime import timedelta

import covers
import images
from database import get_db
from fastapi import APIRouter, Depends, HTTPException, Request
from metrics import (
    _chronotype,
    _compute_bar_race,
    _ENERGY_LOUDNESS_ADJ,
    _listening_streaks,
    _MONTH_ABBR,
    _smoothed_rank_frames,
    _tz_offset_minutes,
    _umbrella_genre,
    _WEEKDAY_NAMES,
)
from sqlalchemy.engine import Connection
from starlette.concurrency import run_in_threadpool

router = APIRouter()


# ── Year filter ───────────────────────────────────────────────────────────────
def _parse_year(year: str):
    """``'all'`` (the default) → ``None`` = every play ever; a 4-digit year → int.

    Anything else is a 400. This whitelist is the *only* reason the value is safe
    to inline into SQL further down, so never widen it to free text.
    """
    value = (year or "all").strip().lower()
    if value == "all":
        return None
    if not (value.isdigit() and len(value) == 4):
        raise HTTPException(status_code=400, detail="Invalid year filter.")
    return int(value)


def _year_clause(year, off: int, alias: str = "") -> str:
    """`` AND EXTRACT(year FROM ts + tz) = YYYY`` fragment, or ``''`` for all time.

    Year boundaries use the same local-time shift the rest of the page uses, so a
    play at 23:00 on New Year's Eve lands in the year the listener lived it.
    `year` and `off` are validated ints → safe to inline. `alias` is the table
    prefix for joined queries (e.g. ``"h."``).
    """
    if year is None:
        return ""
    return f" AND EXTRACT(year FROM {alias}ts + to_minutes({int(off)})) = {int(year)}"


def _year_where(clause: str) -> str:
    """A year clause promoted to a standalone WHERE (empty when unfiltered)."""
    return " WHERE" + clause[len(" AND"):] if clause else ""


def _period_label(value: int, year) -> str:
    """Trend x-axis label: the year when unfiltered, the month inside one year."""
    if year is None:
        return str(value)
    return _MONTH_ABBR[value - 1] if 1 <= value <= 12 else str(value)


def _available_years(raw_con, off: int):
    """Years this session has plays in, newest first."""
    try:
        rows = raw_con.execute(
            f"SELECT DISTINCT EXTRACT(year FROM ts + to_minutes({int(off)}))::INTEGER AS y "
            "FROM history WHERE ts IS NOT NULL ORDER BY y DESC"
        ).fetchall()
    except Exception:
        return []
    return [{"year": int(r[0])} for r in rows]


@router.get("/api/metrics/years")
async def get_years(conn: Connection = Depends(get_db)):
    """Year options for the explore-page filter. Empty list (never a 500) when the
    session has no history yet — the frontend then shows "All time" alone."""

    def query():
        raw_con = conn.connection.driver_connection
        return _available_years(raw_con, _tz_offset_minutes(raw_con))

    years = await run_in_threadpool(query)
    return {"status": "ok", "years": years}


def _canonical_artist_rows(raw_con, period_trunc, year=None, off=0):
    """Per-period ``(period, display_name, ms, streams)`` rows with accent/case
    artist-name variants merged (Spotify exports the same artist under multiple
    spellings, e.g. 'GIVĒON' vs 'Giveon'). Grouped by a diacritic-insensitive
    key; the display name is the most-played spelling, kept identical across
    periods so the merge holds for every frame. ``period_trunc`` is an internal
    literal ('week' / 'month'), never user input.
    """
    inner = _year_clause(year, off)
    outer = _year_clause(year, off, "h.")
    return raw_con.execute(
        f"""
        WITH disp AS (
            SELECT strip_accents(upper(trim(artist_name))) AS akey,
                   arg_max(artist_name, n) AS name
            FROM (
                SELECT artist_name, COUNT(*) AS n
                FROM history
                WHERE artist_name IS NOT NULL AND ts IS NOT NULL{inner}
                GROUP BY artist_name
            ) GROUP BY akey
        )
        SELECT date_trunc('{period_trunc}', h.ts) AS period,
               disp.name AS artist_name,
               SUM(h.ms_played) AS ms,
               COUNT(*) AS streams
        FROM history h
        JOIN disp ON strip_accents(upper(trim(h.artist_name))) = disp.akey
        WHERE h.artist_name IS NOT NULL AND h.ts IS NOT NULL{outer}
        GROUP BY date_trunc('{period_trunc}', h.ts), disp.name
        ORDER BY period ASC, ms DESC, streams DESC
        """
    ).fetchall()


def _canonical_artist_id_map(raw_con):
    """``{canonical akey: artist_id}`` for cover lookups on merged artist names."""
    try:
        return {
            r[0]: r[1]
            for r in raw_con.execute(
                "SELECT strip_accents(upper(trim(artist_name))) AS akey, arg_max(artist_id, c) "
                "FROM (SELECT artist_name, artist_id, COUNT(*) AS c FROM track_features "
                "WHERE artist_id IS NOT NULL GROUP BY artist_name, artist_id) GROUP BY akey"
            ).fetchall()
        }
    except Exception:
        return {}


def _attach_image_urls(raw_con, kind, items):
    """Add a read-only, cached ``image_url`` to each item carrying a Spotify
    ``id``. None when the id is missing, un-warmed, or a genuine art-less miss.
    One batch cache read per kind; never fetches oEmbed.

    An item may override the endpoint's ``kind`` via ``cover_kind``/``cover_id``
    — an album with no catalog id borrows one of its tracks, whose thumbnail is
    the same artwork (see :mod:`covers`).
    """
    by_kind: dict[str, list[str]] = {}
    for it in items:
        cover_id = it.get("cover_id") or it.get("id")
        if cover_id:
            by_kind.setdefault(it.get("cover_kind") or kind, []).append(cover_id)
    url_maps = {k: images.cached_urls(raw_con, k, ids) for k, ids in by_kind.items()}
    for it in items:
        cover_id = it.get("cover_id") or it.get("id")
        url_map = url_maps.get(it.get("cover_kind") or kind, {})
        it["image_url"] = url_map.get(cover_id) if cover_id else None


@router.get("/api/metrics/artist-rank")
async def get_artist_rank(
    request: Request,
    limit: int = 10,
    year: str = "all",
    conn: Connection = Depends(get_db),
):
    yr = _parse_year(year)

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con) if yr is not None else 0
        try:
            monthly_data = _canonical_artist_rows(raw_con, "week", yr, off)
        except Exception:
            monthly_data = []

        full_months, featured = _smoothed_rank_frames(
            monthly_data, key_len=1, limit=limit
        )
        id_map = _canonical_artist_id_map(raw_con)
        data = [
            {
                "rank": idx,
                "artist_name": f["key"][0],
                "id": id_map.get(_norm_artist_key(f["key"][0])),
                "total_streams": f["total_streams"],
                "total_minutes": round(f["total_ms"] / 60000, 2),
                "monthly_ranks": f["monthly_ranks"],
            }
            for idx, f in enumerate(featured, start=1)
        ]
        _attach_image_urls(raw_con, "artist", data)
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
        "year": yr,
        "start_month": res["start_month"],
        "end_month": res["end_month"],
        "total_months": res["total_months"],
        "months": res["months"],
        "data": res["data"],
    }


@router.get("/api/metrics/track-rank")
async def get_track_rank(
    request: Request,
    limit: int = 10,
    year: str = "all",
    conn: Connection = Depends(get_db),
):
    yr = _parse_year(year)

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con) if yr is not None else 0
        clause = _year_clause(yr, off)
        try:
            monthly_data = raw_con.execute(f"""
                SELECT 
                    date_trunc('week', ts) as period,
                    track_name,
                    artist_name,
                    SUM(ms_played) as ms,
                    COUNT(*) as streams
                FROM history
                WHERE track_name IS NOT NULL AND ts IS NOT NULL{clause}
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
        _attach_image_urls(raw_con, "track", data)
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
        "year": yr,
        "start_month": res["start_month"],
        "end_month": res["end_month"],
        "total_months": res["total_months"],
        "months": res["months"],
        "data": res["data"],
    }


@router.get("/api/metrics/bar-race")
async def get_bar_race(
    request: Request,
    entity: str = "artist",
    limit: int = 12,
    year: str = "all",
    conn: Connection = Depends(get_db),
):
    """Cumulative-listening bar race frames for artist / track / album."""
    entity = entity.lower()
    yr = _parse_year(year)
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
        off = _tz_offset_minutes(raw_con) if yr is not None else 0
        try:
            if entity == "artist":
                rows = _canonical_artist_rows(raw_con, "month", yr, off)
                # _compute_bar_race ignores the trailing streams column.
            else:
                rows = raw_con.execute(
                    f"""
                    SELECT date_trunc('month', ts) AS month, {cols}, SUM(ms_played) AS ms
                    FROM history
                    WHERE {name_col} IS NOT NULL AND ts IS NOT NULL{_year_clause(yr, off)}
                    GROUP BY date_trunc('month', ts), {cols}
                    """
                ).fetchall()
        except Exception:
            rows = []

        full_months, featured = _compute_bar_race(rows, key_len, limit)

        # Best-effort id lookup so the frontend can lazy-load cover art.
        # Albums resolve separately (identity-based, with a track fallback) once
        # the items exist — see :mod:`covers`.
        id_map: dict = {}
        try:
            if entity == "artist":
                id_map = _canonical_artist_id_map(raw_con)
            elif entity == "track":
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
            cover_id = (
                id_map.get(_norm_artist_key(f["key"][0]))
                if entity == "artist"
                else id_map.get(f["key"])
            )
            item = {
                "rank": idx,
                "name": f["key"][0],
                "id": cover_id,
                "total_minutes": round(f["total_ms"] / 60000, 2),
                "cumulative_minutes": [
                    round(v / 60000, 2) for v in f["cumulative_ms"]
                ],
            }
            if key_len == 2:
                item["artist_name"] = f["key"][1]
            data.append(item)

        if entity == "album":
            covers.attach_album_cover_refs(
                raw_con, data, name_key="name", artist_key="artist_name"
            )

        _attach_image_urls(raw_con, entity, data)
        return {
            "start_month": full_months[0] if full_months else None,
            "end_month": full_months[-1] if full_months else None,
            "total_months": len(full_months),
            "months": full_months,
            "data": data,
        }

    res = await run_in_threadpool(query)
    return {"status": "ok", "entity": entity, "year": yr, "unit": "minutes", **res}


@router.get("/api/metrics/rhythm")
async def get_rhythm(
    request: Request,
    year: str = "all",
    conn: Connection = Depends(get_db),
):
    """Temporal listening patterns for the "When You Listen" chapter: plays by
    hour of day, weekday and month of year, plus daily streaks and a chronotype
    score. Timestamps are shifted from UTC into the user's local time (derived
    from their dominant conn_country) so hours read as wall-clock.
    """
    yr = _parse_year(year)

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con)
        clause = _year_clause(yr, off)

        def fetch(sql, params=None):
            try:
                return raw_con.execute(sql, params).fetchall() if params else raw_con.execute(sql).fetchall()
            except Exception:
                return []

        hourly = [0] * 24
        for h, c in fetch(
            "SELECT EXTRACT(hour FROM ts + to_minutes(?))::INTEGER AS h, COUNT(*) "
            f"FROM history WHERE ts IS NOT NULL{clause} GROUP BY h",
            [off],
        ):
            if h is not None and 0 <= int(h) <= 23:
                hourly[int(h)] = int(c)

        weekday = [0] * 7  # Mon..Sun
        for d, c in fetch(
            "SELECT EXTRACT(isodow FROM ts + to_minutes(?))::INTEGER AS d, COUNT(*) "
            f"FROM history WHERE ts IS NOT NULL{clause} GROUP BY d",
            [off],
        ):
            if d is not None and 1 <= int(d) <= 7:
                weekday[int(d) - 1] = int(c)

        monthly = [0] * 12  # Jan..Dec
        for m, c in fetch(
            "SELECT EXTRACT(month FROM ts + to_minutes(?))::INTEGER AS m, COUNT(*) "
            f"FROM history WHERE ts IS NOT NULL{clause} GROUP BY m",
            [off],
        ):
            if m is not None and 1 <= int(m) <= 12:
                monthly[int(m) - 1] = int(c)

        day_rows = fetch(
            "SELECT DISTINCT CAST(ts + to_minutes(?) AS DATE) AS day FROM history "
            f"WHERE ts IS NOT NULL{clause} ORDER BY day",
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
        "year": yr,
        "hourly": hourly,
        "peak_hour": peak_hour,
        "weekday": weekday,
        "busiest_weekday": busiest_weekday,
        "monthly": monthly,
        "chronotype": _chronotype(hourly),
        "streak": _listening_streaks(days),
        "total_streams": total_streams,
    }


@router.get("/api/metrics/audio")
async def get_audio(
    request: Request,
    year: str = "all",
    conn: Connection = Depends(get_db),
):
    """Audio-feature profile for the "Your Sound" chapter, from the enriched
    track_features slice: play-weighted average mood/energy/etc., per-track
    valence/energy for the mood map, and catalog coverage. Empty when the
    track_features slice is missing (unenriched session).
    """
    yr = _parse_year(year)

    _JOIN = (
        "FROM history h JOIN track_features f "
        "ON split_part(h.track_uri, ':', 3) = f.track_id "
        "WHERE h.track_uri LIKE 'spotify:track:%'"
    )
    # De-inflate that loudness bias for the affected genres only, keyed on the
    # PRIMARY artist genre (a global shift would wrongly flatten real pop/latin/EDM).
    _ADJ_E = (
        "CASE WHEN "
        "lower(split_part(f.artist_genres, ',', 1)) LIKE '%r&b%' "
        "OR lower(split_part(f.artist_genres, ',', 1)) LIKE '%soul%' "
        "OR lower(split_part(f.artist_genres, ',', 1)) LIKE '%hip hop%' "
        "OR lower(split_part(f.artist_genres, ',', 1)) LIKE '%rap%' "
        "OR lower(split_part(f.artist_genres, ',', 1)) LIKE '%trap%' "
        f"THEN greatest(0, f.energy - {_ENERGY_LOUDNESS_ADJ}) "
        "ELSE f.energy END"
    )

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con) if yr is not None else 0
        join = _JOIN + _year_clause(yr, off, "h.")
        try:
            agg = raw_con.execute(
                "SELECT AVG(" + _ADJ_E + "), AVG(f.valence), AVG(f.danceability), "
                "AVG(f.acousticness), AVG(f.instrumentalness), AVG(f.tempo), "
                "AVG(CASE WHEN f.mode = 1 THEN 1.0 ELSE 0.0 END), COUNT(*) " + join
            ).fetchone()
        except Exception:
            return None
        if not agg or not agg[7]:
            return None
        energy, valence, dance, acoustic, instr, tempo, major, matched = agg

        try:
            trows = raw_con.execute(
                "SELECT any_value(h.track_name), any_value(f.valence), any_value("
                + _ADJ_E + "), COUNT(*) AS plays "
                + join + " AND h.track_name IS NOT NULL "
                "AND f.valence IS NOT NULL AND f.energy IS NOT NULL "
                "GROUP BY f.track_id ORDER BY plays DESC LIMIT 24"
            ).fetchall()
        except Exception:
            trows = []

        try:
            total = raw_con.execute(
                "SELECT COUNT(*) FROM history WHERE track_uri LIKE 'spotify:track:%'"
                + _year_clause(yr, off)
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
            "year": yr,
            "avg": None,
            "tracks": [],
            "coverage": 0.0,
            "matched": 0,
            "total": 0,
        }
    total = res["total"]
    res["coverage"] = round(res["matched"] / total, 4) if total else 0.0
    return {"status": "ok", "year": yr, **res}


@router.get("/api/metrics/taste")
async def get_taste(year: str = "all", conn: Connection = Depends(get_db)):
    """Genre / era / popularity profile for the "Your Taste" chapter, from the
    enriched track_features slice. Empty genres when unenriched → the frontend
    keeps its sample fallback.
    """
    yr = _parse_year(year)

    _JOIN = (
        "FROM history h JOIN track_features f "
        "ON split_part(h.track_uri, ':', 3) = f.track_id "
        "WHERE h.track_uri LIKE 'spotify:track:%'"
    )

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con) if yr is not None else 0
        join = _JOIN + _year_clause(yr, off, "h.")

        # Primary genre → plays, then fold into umbrella buckets in Python.
        try:
            grows = raw_con.execute(
                "SELECT lower(split_part(f.artist_genres, ',', 1)) AS g, COUNT(*) AS plays "
                + join + " AND f.artist_genres IS NOT NULL AND f.artist_genres <> '' "
                "GROUP BY g"
            ).fetchall()
        except Exception:
            return None

        buckets: dict[str, int] = {}
        for raw, plays in grows:
            label = _umbrella_genre(raw)
            if label:
                buckets[label] = buckets.get(label, 0) + int(plays)
        if not buckets:
            return None
        ranked = sorted(buckets.items(), key=lambda kv: kv[1], reverse=True)
        total_genre_plays = sum(buckets.values()) or 1
        genres = [{"name": name, "plays": plays} for name, plays in ranked[:6]]
        # Count only genres with a real presence (>=1% of plays) so the diversity
        # word doesn't inflate on a long tail of one-off tags.
        distinct_genres = sum(1 for _, p in buckets.items() if p / total_genre_plays >= 0.01)

        try:
            mainstream = raw_con.execute(
                "SELECT AVG(f.popularity) " + join + " AND f.popularity IS NOT NULL"
            ).fetchone()[0]
        except Exception:
            mainstream = None

        eras = []
        avg_year = None
        try:
            erows = raw_con.execute(
                "SELECT CAST(floor(CAST(f.release_year AS INTEGER) / 10) * 10 AS INTEGER) AS decade, "
                "COUNT(*) AS plays " + join
                + " AND f.release_year IS NOT NULL AND CAST(f.release_year AS INTEGER) > 1900 "
                "GROUP BY decade ORDER BY decade"
            ).fetchall()
            eras = [{"decade": int(d), "plays": int(p)} for d, p in erows]
            ay = raw_con.execute(
                "SELECT AVG(CAST(f.release_year AS DOUBLE)) " + join
                + " AND f.release_year IS NOT NULL AND CAST(f.release_year AS INTEGER) > 1900"
            ).fetchone()[0]
            avg_year = int(round(ay)) if ay else None
        except Exception:
            eras = []

        # Hidden gems = low global popularity but high personal plays.
        gems = []
        try:
            gemrows = raw_con.execute(
                "SELECT f.track_id, any_value(h.track_name), any_value(h.artist_name), COUNT(*) AS plays "
                + join + " AND f.popularity IS NOT NULL AND f.popularity < 0.4 "
                "AND h.track_name IS NOT NULL "
                "GROUP BY f.track_id HAVING COUNT(*) >= 5 ORDER BY plays DESC LIMIT 4"
            ).fetchall()
            gems = [{"name": r[1], "artist": r[2] or "", "plays": int(r[3]), "id": r[0]} for r in gemrows]
        except Exception:
            gems = []

        return {
            "genres": genres,
            "mainstream": round(mainstream, 3) if mainstream is not None else None,
            "distinct_genres": distinct_genres,
            "eras": eras,
            "avg_year": avg_year,
            "gems": gems,
        }

    res = await run_in_threadpool(query)
    if not res:
        return {
            "status": "ok",
            "year": yr,
            "genres": [],
            "mainstream": None,
            "distinct_genres": 0,
            "eras": [],
            "avg_year": None,
            "gems": [],
        }
    return {"status": "ok", "year": yr, **res}


@router.get("/api/metrics/behavior")
async def get_behavior(year: str = "all", conn: Connection = Depends(get_db)):
    """Listening-habit profile for the "How You Listen" chapter, from history only
    (100% coverage, no catalog dependency). shuffle=None when history is missing so
    the frontend keeps its sample fallback.

    "Skip" is defined as pressing next (reason_end = 'fwdbtn') — a deliberate action,
    more reliable than the coarse `skipped` flag or a raw <30s cutoff.
    """
    yr = _parse_year(year)

    _MUSIC = "FROM history WHERE track_uri LIKE 'spotify:track:%'"

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con) if yr is not None else 0
        clause = _year_clause(yr, off)

        try:
            row = raw_con.execute(
                "SELECT "
                "AVG(CASE WHEN shuffle THEN 1.0 ELSE 0.0 END) AS shuffle, "
                "AVG(CASE WHEN reason_end = 'fwdbtn' THEN 1.0 ELSE 0.0 END) AS skip_rate, "
                "AVG(CASE WHEN COALESCE(reason_end, '') = 'trackdone' THEN 1.0 ELSE 0.0 END) AS finished, "
                "AVG(CASE WHEN COALESCE(reason_end, '') <> 'trackdone' AND ms_played < 30000 THEN 1.0 ELSE 0.0 END) AS under30, "
                "AVG(CASE WHEN COALESCE(reason_end, '') <> 'trackdone' AND ms_played >= 30000 THEN 1.0 ELSE 0.0 END) AS partial, "
                "COUNT(*) AS n " + _MUSIC + clause
            ).fetchone()
        except Exception:
            return None
        if not row or not row[5]:
            return None
        shuffle, skip_rate, finished, under30, partial, _n = row

        # Longest binge: cluster plays into sessions (gap > 30 min starts a new one),
        # then take the longest session's wall-clock span in minutes.
        longest_binge = 0
        try:
            b = raw_con.execute(
                "WITH o AS ("
                "  SELECT ts, LAG(ts) OVER (ORDER BY ts) AS prev FROM history "
                f" WHERE ts IS NOT NULL{clause}"
                "), m AS ("
                "  SELECT ts, CASE WHEN prev IS NULL OR date_diff('minute', prev, ts) > 30 THEN 1 ELSE 0 END AS ns FROM o"
                "), s AS ("
                "  SELECT ts, SUM(ns) OVER (ORDER BY ts) AS sid FROM m"
                ") SELECT COALESCE(MAX(dur), 0) FROM ("
                "  SELECT date_diff('second', MIN(ts), MAX(ts)) / 60.0 AS dur FROM s GROUP BY sid"
                ")"
            ).fetchone()[0]
            longest_binge = int(round(b or 0))
        except Exception:
            longest_binge = 0

        # Loops: tracks played back-to-back (same track as the previous play). Only
        # count repeats that were actually listened to (>=30s) so auto-repeat skips
        # don't masquerade as favourites.
        loops = []
        try:
            lrows = raw_con.execute(
                "WITH o AS ("
                "  SELECT ts, track_uri, track_name, artist_name, ms_played, "
                "         LAG(track_uri) OVER (ORDER BY ts) AS prev_uri "
                "  FROM history WHERE track_uri LIKE 'spotify:track:%' AND ts IS NOT NULL"
                f"{clause}"
                ") SELECT split_part(track_uri, ':', 3) AS id, any_value(track_name), "
                "any_value(artist_name), COUNT(*) AS loops "
                "FROM o WHERE track_uri = prev_uri AND ms_played >= 30000 "
                "GROUP BY track_uri HAVING COUNT(*) >= 2 ORDER BY loops DESC LIMIT 4"
            ).fetchall()
            loops = [
                {"name": r[1], "artist": r[2] or "", "count": int(r[3]), "id": r[0]}
                for r in lrows if r[1]
            ]
        except Exception:
            loops = []

        return {
            "shuffle": round(shuffle or 0, 3),
            "skip_rate": round(skip_rate or 0, 3),
            "longest_binge_min": longest_binge,
            "attention": {
                "under30": round(under30 or 0, 3),
                "partial": round(partial or 0, 3),
                "finished": round(finished or 0, 3),
            },
            "loops": loops,
        }

    res = await run_in_threadpool(query)
    if not res:
        return {
            "status": "ok",
            "year": yr,
            "shuffle": None,
            "skip_rate": None,
            "longest_binge_min": 0,
            "attention": {"under30": 0, "partial": 0, "finished": 0},
            "loops": [],
        }
    return {"status": "ok", "year": yr, **res}


@router.get("/api/metrics/discovery")
async def get_discovery(year: str = "all", conn: Connection = Depends(get_db)):
    """Discovery and loyalty patterns from history, with no catalog dependency.

    Artists count as new for all plays in the month they first appear. A
    rediscovery is a track played again after a 60-day gap. Momentum compares
    the latest 90 days against the preceding 90-day period.
    """
    yr = _parse_year(year)

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con) if yr is not None else 0
        clause = _year_clause(yr, off)
        hclause = _year_clause(yr, off, "h.")
        try:
            summary = raw_con.execute(
                f"""
                WITH plays AS (
                    SELECT artist_name, ts, date_trunc('month', ts) AS month
                    FROM history
                    WHERE artist_name IS NOT NULL AND ts IS NOT NULL{clause}
                ), first_month AS (
                    SELECT artist_name, MIN(month) AS first_month
                    FROM plays GROUP BY artist_name
                ), artist_counts AS (
                    SELECT artist_name, COUNT(*) AS plays
                    FROM plays GROUP BY artist_name
                ), monthly_new AS (
                    SELECT month, COUNT(DISTINCT artist_name) AS artists
                    FROM plays JOIN first_month USING (artist_name)
                    WHERE month = first_month GROUP BY month
                )
                SELECT
                    COALESCE(AVG((month = first_month)::INTEGER), 0),
                    COALESCE((SELECT AVG(artists) FROM monthly_new), 0),
                    COALESCE(AVG((plays = 1)::INTEGER), 0),
                    COUNT(*)
                FROM plays
                JOIN first_month USING (artist_name)
                JOIN artist_counts USING (artist_name)
                """
            ).fetchone()
        except Exception:
            return None
        if not summary or not summary[3]:
            return None

        rediscoveries = []
        try:
            rows = raw_con.execute(
                f"""
                WITH ordered AS (
                    SELECT track_uri, track_name, artist_name, ts,
                           LAG(ts) OVER (PARTITION BY track_uri ORDER BY ts) AS previous_ts
                    FROM history
                    WHERE track_uri LIKE 'spotify:track:%'
                      AND track_name IS NOT NULL AND artist_name IS NOT NULL AND ts IS NOT NULL{clause}
                ), returning_tracks AS (
                    SELECT DISTINCT track_uri
                    FROM ordered
                    WHERE date_diff('day', previous_ts, ts) >= 60
                )
                SELECT split_part(h.track_uri, ':', 3) AS id, ANY_VALUE(h.track_name),
                       ANY_VALUE(h.artist_name), COUNT(*) AS plays
                FROM history h JOIN returning_tracks r USING (track_uri)
                {_year_where(hclause)}
                GROUP BY h.track_uri
                ORDER BY plays DESC, 2
                LIMIT 4
                """
            ).fetchall()
            rediscoveries = [
                {"id": row[0], "name": row[1], "artist": row[2], "plays": int(row[3])}
                for row in rows
            ]
        except Exception:
            pass

        rising = []
        try:
            rows = raw_con.execute(
                f"""
                WITH bounds AS (
                    SELECT MAX(ts) AS latest FROM history WHERE ts IS NOT NULL{clause}
                ), artist_plays AS (
                    SELECT artist_name,
                           COUNT(*) FILTER (WHERE ts > latest - INTERVAL 90 DAY) AS recent,
                           COUNT(*) FILTER (
                               WHERE ts > latest - INTERVAL 180 DAY
                                 AND ts <= latest - INTERVAL 90 DAY
                           ) AS previous
                    FROM history CROSS JOIN bounds
                    WHERE artist_name IS NOT NULL AND ts IS NOT NULL{clause}
                    GROUP BY artist_name
                )
                SELECT artist_name, ROUND((recent - previous) * 100.0 / previous)::INTEGER
                FROM artist_plays
                WHERE previous >= 2 AND recent > previous
                ORDER BY 2 DESC, recent DESC, artist_name
                LIMIT 4
                """
            ).fetchall()
            artist_ids = {}
            try:
                artist_ids = {
                    row[0]: row[1]
                    for row in raw_con.execute(
                        "SELECT artist_name, MAX(artist_id) FROM track_features "
                        "WHERE artist_name IS NOT NULL AND artist_id IS NOT NULL "
                        "GROUP BY artist_name"
                    ).fetchall()
                }
            except Exception:
                pass
            rising = [
                {"name": row[0], "share": int(row[1]), "id": artist_ids.get(row[0])}
                for row in rows
            ]
        except Exception:
            pass

        return {
            "new_artist_share": round(float(summary[0] or 0), 3),
            "new_artists_monthly": round(float(summary[1] or 0), 1),
            "one_off_share": round(float(summary[2] or 0), 3),
            "rediscoveries": rediscoveries,
            "rising": rising,
        }

    res = await run_in_threadpool(query)
    if not res:
        return {
            "status": "ok",
            "year": yr,
            "new_artist_share": 0.0,
            "new_artists_monthly": 0.0,
            "one_off_share": 0.0,
            "rediscoveries": [],
            "rising": [],
        }
    return {"status": "ok", "year": yr, **res}


@router.get("/api/metrics/listening-life")
async def get_listening_life(year: str = "all", conn: Connection = Depends(get_db)):
    """Peak listening periods, session pace, and chronological play milestones.

    All values use music plays from history. Peak day, week, and month are
    based on listened time; sessions split after 30 minutes without a play.
    """
    yr = _parse_year(year)

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con)
        music = (
            "WHERE track_uri LIKE 'spotify:track:%' AND ts IS NOT NULL"
            + _year_clause(yr, off)
        )

        try:
            day = raw_con.execute(
                f"SELECT CAST(ts + to_minutes({off}) AS DATE), SUM(COALESCE(ms_played, 0)) "
                f"FROM history {music} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1"
            ).fetchone()
            week = raw_con.execute(
                f"SELECT CAST(date_trunc('week', ts + to_minutes({off})) AS DATE), "
                f"SUM(COALESCE(ms_played, 0)) FROM history {music} "
                "GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1"
            ).fetchone()
            month = raw_con.execute(
                f"SELECT CAST(date_trunc('month', ts + to_minutes({off})) AS DATE), "
                f"SUM(COALESCE(ms_played, 0)) FROM history {music} "
                "GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1"
            ).fetchone()
        except Exception:
            return None

        if not day:
            return None

        def format_day(value):
            return f"{value.strftime('%B')} {value.day}, {value.year}"

        def format_week(value):
            end = value + timedelta(days=6)
            if value.month == end.month and value.year == end.year:
                return f"{value.strftime('%B')} {value.day}-{end.day}, {value.year}"
            return f"{format_day(value)} - {format_day(end)}"

        peaks = [
            {"label": "Day", "minutes": round(day[1] / 60000, 2), "period": format_day(day[0])},
            {"label": "Week", "minutes": round(week[1] / 60000, 2), "period": format_week(week[0])},
            {"label": "Month", "minutes": round(month[1] / 60000, 2), "period": month[0].strftime("%B %Y")},
        ]

        try:
            session_rows = raw_con.execute(
                f"""
                WITH ordered AS (
                    SELECT ts, COALESCE(ms_played, 0) AS ms_played,
                           LAG(ts) OVER (ORDER BY ts) AS previous_ts
                    FROM history {music}
                ), marked AS (
                    SELECT ts, ms_played,
                           CASE WHEN previous_ts IS NULL
                                     OR date_diff('minute', previous_ts, ts) > 30
                                THEN 1 ELSE 0 END AS starts_session
                    FROM ordered
                ), sessions AS (
                    SELECT ms_played,
                           SUM(starts_session) OVER (ORDER BY ts) AS session_id
                    FROM marked
                )
                SELECT SUM(ms_played) / 60000.0 AS minutes
                FROM sessions GROUP BY session_id
                """
            ).fetchall()
        except Exception:
            session_rows = []

        sessions = sorted(float(row[0] or 0) for row in session_rows)
        if sessions:
            middle = len(sessions) // 2
            median = sessions[middle] if len(sessions) % 2 else (sessions[middle - 1] + sessions[middle]) / 2
            typical_session_minutes = int(round(median))
            buckets = [0, 0, 0, 0]
            for minutes in sessions:
                if minutes < 15:
                    buckets[0] += 1
                elif minutes < 30:
                    buckets[1] += 1
                elif minutes < 60:
                    buckets[2] += 1
                else:
                    buckets[3] += 1
            total_sessions = len(sessions)
            session_mix = [
                {"label": label, "share": round(count / total_sessions, 3)}
                for label, count in zip(("Under 15m", "15-30m", "30-60m", "Over 1h"), buckets)
            ]
        else:
            typical_session_minutes = 0
            session_mix = []

        milestones = []
        try:
            for target in (1000, 5000, 10000):
                row = raw_con.execute(
                    f"""
                    WITH ordered AS (
                        SELECT ts + to_minutes({off}) AS local_ts, track_name, artist_name,
                               ROW_NUMBER() OVER (ORDER BY ts) AS play_number
                        FROM history {music}
                    )
                    SELECT local_ts, track_name, artist_name
                    FROM ordered WHERE play_number >= ?
                    ORDER BY play_number LIMIT 1
                    """,
                    [target],
                ).fetchone()
                if row:
                    milestones.append(
                        {
                            "target": target,
                            "date": row[0].strftime("%B %Y"),
                            "track": row[1] or "Unknown track",
                            "artist": row[2] or "",
                        }
                    )
        except Exception:
            milestones = []

        return {
            "peaks": peaks,
            "typical_session_minutes": typical_session_minutes,
            "session_mix": session_mix,
            "milestones": milestones,
        }

    res = await run_in_threadpool(query)
    if not res:
        return {
            "status": "ok",
            "year": yr,
            "peaks": [],
            "typical_session_minutes": 0,
            "session_mix": [],
            "milestones": [],
        }
    return {"status": "ok", "year": yr, **res}


@router.get("/api/metrics/over-time")
async def get_over_time(year: str = "all", conn: Connection = Depends(get_db)):
    """Year-by-year highlights plus release-year context for the "Your Music,
    Over Time" chapter. Per-year top artist / top track / song-of-summer come
    from history; music age, oldest/newest tracks and the nostalgia trend need
    the enriched track_features slice and stay empty when unenriched.

    With a year selected the highlights narrow to that year and the nostalgia
    trend switches from year-by-year to month-by-month inside it.
    """
    yr = _parse_year(year)

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con)  # int minutes; safe to inline
        music = (
            "WHERE track_uri LIKE 'spotify:track:%' AND ts IS NOT NULL"
            + _year_clause(yr, off)
        )

        # --- Per-year top artist (history only) ---
        try:
            artist_rows = raw_con.execute(
                f"""
                SELECT year, artist_name FROM (
                    SELECT year, artist_name,
                           ROW_NUMBER() OVER (PARTITION BY year ORDER BY c DESC, artist_name) AS rn
                    FROM (
                        SELECT EXTRACT(year FROM ts + to_minutes({off}))::INTEGER AS year,
                               artist_name, COUNT(*) AS c
                        FROM history {music} AND artist_name IS NOT NULL
                        GROUP BY year, artist_name
                    )
                ) WHERE rn = 1
                """
            ).fetchall()
        except Exception:
            return None

        # --- Per-year top track / song of summer (history only) ---
        def top_tracks(summer_only):
            months = (
                f" AND EXTRACT(month FROM ts + to_minutes({off})) IN (6, 7, 8)"
                if summer_only else ""
            )
            return raw_con.execute(
                f"""
                SELECT year, id, track_name, artist_name FROM (
                    SELECT year, id, track_name, artist_name,
                           ROW_NUMBER() OVER (PARTITION BY year ORDER BY c DESC, id) AS rn
                    FROM (
                        SELECT EXTRACT(year FROM ts + to_minutes({off}))::INTEGER AS year,
                               split_part(track_uri, ':', 3) AS id,
                               any_value(track_name) AS track_name,
                               any_value(artist_name) AS artist_name,
                               COUNT(*) AS c
                        FROM history {music} AND track_name IS NOT NULL{months}
                        GROUP BY year, id
                    )
                ) WHERE rn = 1
                """
            ).fetchall()

        try:
            track_rows = top_tracks(False)
            summer_rows = top_tracks(True)
        except Exception:
            track_rows = []
            summer_rows = []

        artist_by_year = {int(r[0]): r[1] for r in artist_rows}
        track_by_year = {int(r[0]): {"id": r[1], "name": r[2], "artist": r[3]} for r in track_rows}
        summer_by_year = {int(r[0]): {"id": r[1], "name": r[2], "artist": r[3]} for r in summer_rows}

        artist_ids = {}
        try:
            artist_ids = {
                r[0]: r[1]
                for r in raw_con.execute(
                    "SELECT artist_name, MAX(artist_id) FROM track_features "
                    "WHERE artist_name IS NOT NULL AND artist_id IS NOT NULL GROUP BY artist_name"
                ).fetchall()
            }
        except Exception:
            artist_ids = {}

        years = []
        for y in sorted(track_by_year):
            track = track_by_year[y]
            summer = summer_by_year.get(y) or track
            artist_name = artist_by_year.get(y)
            years.append(
                {
                    "year": y,
                    "top_artist": {"name": artist_name, "id": artist_ids.get(artist_name)},
                    "top_track": {"name": track["name"], "artist": track["artist"], "id": track["id"]},
                    "summer_track": {"name": summer["name"], "artist": summer["artist"], "id": summer["id"]},
                }
            )

        if not years:
            return None

        join = (
            "FROM history h JOIN track_features f "
            "ON split_part(h.track_uri, ':', 3) = f.track_id "
            "WHERE h.track_uri LIKE 'spotify:track:%' AND h.ts IS NOT NULL "
            "AND f.release_year IS NOT NULL AND CAST(f.release_year AS INTEGER) > 1900"
            + _year_clause(yr, off, "h.")
        )

        # --- Music age: fresh (<=1yr old when played) vs catalog + average year ---
        music_age = {}
        try:
            row = raw_con.execute(
                f"SELECT AVG((CAST(f.release_year AS INTEGER) >= "
                f"EXTRACT(year FROM h.ts + to_minutes({off})) - 1)::INTEGER), "
                f"AVG(CAST(f.release_year AS DOUBLE)) {join}"
            ).fetchone()
            if row and row[0] is not None:
                music_age = {
                    "fresh_share": round(float(row[0]), 3),
                    "avg_year": int(round(row[1])) if row[1] else None,
                }
        except Exception:
            music_age = {}

        # --- Time machine: oldest & newest track played ---
        time_machine = {}
        try:
            def extreme(order):
                r = raw_con.execute(
                    f"SELECT split_part(h.track_uri, ':', 3) AS id, any_value(h.track_name), "
                    f"any_value(h.artist_name), CAST(any_value(f.release_year) AS INTEGER) AS year, "
                    f"COUNT(*) AS plays {join} AND h.track_name IS NOT NULL "
                    f"GROUP BY id ORDER BY year {order}, plays DESC LIMIT 1"
                ).fetchone()
                if not r:
                    return None
                return {"id": r[0], "name": r[1], "artist": r[2] or "", "year": int(r[3])}

            oldest = extreme("ASC")
            newest = extreme("DESC")
            if oldest or newest:
                time_machine = {"oldest": oldest, "newest": newest}
        except Exception:
            time_machine = {}

        # --- Nostalgia: average release year of what you played, per period ---
        nostalgia = []
        try:
            part = "month" if yr is not None else "year"
            rows = raw_con.execute(
                f"SELECT EXTRACT({part} FROM h.ts + to_minutes({off}))::INTEGER AS period, "
                f"AVG(CAST(f.release_year AS DOUBLE)) {join} GROUP BY period ORDER BY period"
            ).fetchall()
            nostalgia = [
                {"period": _period_label(int(r[0]), yr), "avg_year": int(round(r[1]))}
                for r in rows if r[1]
            ]
        except Exception:
            nostalgia = []

        return {
            "years": years,
            "music_age": music_age,
            "time_machine": time_machine,
            "nostalgia": nostalgia,
        }

    res = await run_in_threadpool(query)
    if not res:
        return {
            "status": "ok",
            "year": yr,
            "years": [],
            "music_age": {},
            "time_machine": {},
            "nostalgia": [],
        }
    return {"status": "ok", "year": yr, **res}


@router.get("/api/metrics/evolution")
async def get_evolution(year: str = "all", conn: Connection = Depends(get_db)):
    """Taste-shift trends for the "How Your Taste Changes" chapter, from the
    enriched track_features slice: genre mix per year, average positivity and
    popularity per year, and a morning-vs-late-night energy compare. Empty when
    unenriched → the frontend keeps its sample fallback.

    With a year selected every trend switches from year-by-year to month-by-month
    inside that year; the response shape is unchanged (periods stay strings).
    """
    yr = _parse_year(year)

    _JOIN = (
        "FROM history h JOIN track_features f "
        "ON split_part(h.track_uri, ':', 3) = f.track_id "
        "WHERE h.track_uri LIKE 'spotify:track:%' AND h.ts IS NOT NULL"
    )
    # Same primary-genre energy de-inflation the audio chapter uses, so the
    # day-vs-night words read on the corrected scale.
    _ADJ_E = (
        "CASE WHEN "
        "lower(split_part(f.artist_genres, ',', 1)) LIKE '%r&b%' "
        "OR lower(split_part(f.artist_genres, ',', 1)) LIKE '%soul%' "
        "OR lower(split_part(f.artist_genres, ',', 1)) LIKE '%hip hop%' "
        "OR lower(split_part(f.artist_genres, ',', 1)) LIKE '%rap%' "
        "OR lower(split_part(f.artist_genres, ',', 1)) LIKE '%trap%' "
        f"THEN greatest(0, f.energy - {_ENERGY_LOUDNESS_ADJ}) "
        "ELSE f.energy END"
    )

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con)  # int minutes; safe to inline
        join = _JOIN + _year_clause(yr, off, "h.")
        part = "month" if yr is not None else "year"
        year_expr = f"EXTRACT({part} FROM h.ts + to_minutes({off}))::INTEGER"

        # --- Genre mix per period (raw primary genre, folded to umbrellas here) ---
        try:
            rows = raw_con.execute(
                f"SELECT {year_expr} AS year, "
                "lower(split_part(f.artist_genres, ',', 1)) AS g, COUNT(*) AS plays "
                + join + " AND f.artist_genres IS NOT NULL AND f.artist_genres <> '' "
                "GROUP BY year, g"
            ).fetchall()
        except Exception:
            return None
        if not rows:
            return None

        per_year: dict[int, dict[str, int]] = {}
        totals: dict[str, int] = {}
        for year, raw, plays in rows:
            label = _umbrella_genre(raw)
            if not label:
                continue
            y = int(year)
            per_year.setdefault(y, {})
            per_year[y][label] = per_year[y].get(label, 0) + int(plays)
            totals[label] = totals.get(label, 0) + int(plays)
        if not per_year:
            return None

        periods = sorted(per_year)
        top = [name for name, _ in sorted(totals.items(), key=lambda kv: kv[1], reverse=True)[:5]]
        top_set = set(top)
        year_totals = {y: sum(per_year[y].values()) for y in periods}

        genres = []
        for name in top:
            genres.append({
                "name": name,
                "shares": [
                    round(per_year[y].get(name, 0) / year_totals[y], 4) if year_totals[y] else 0.0
                    for y in periods
                ],
            })
        # Fold everything outside the top 5 into a single "Other" band.
        other_shares = []
        has_other = False
        for y in periods:
            other = sum(p for g, p in per_year[y].items() if g not in top_set)
            if other:
                has_other = True
            other_shares.append(round(other / year_totals[y], 4) if year_totals[y] else 0.0)
        if has_other:
            genres.append({"name": "Other", "shares": other_shares})

        genre_evolution = {
            "periods": [_period_label(y, yr) for y in periods],
            "genres": genres,
        }

        # --- Mood (avg positivity) & mainstream (avg popularity) per period ---
        def yearly(expr, cond):
            try:
                return raw_con.execute(
                    f"SELECT {year_expr} AS year, AVG({expr}) {join} AND {cond} "
                    "GROUP BY year ORDER BY year"
                ).fetchall()
            except Exception:
                return []

        mood_trend = [
            {"period": _period_label(int(r[0]), yr), "valence": round(float(r[1]), 3)}
            for r in yearly("f.valence", "f.valence IS NOT NULL") if r[1] is not None
        ]
        mainstream_trend = [
            {"period": _period_label(int(r[0]), yr), "popularity": round(float(r[1]), 3)}
            for r in yearly("f.popularity", "f.popularity IS NOT NULL") if r[1] is not None
        ]

        # --- Day vs night energy (5-11am vs 9pm-3am), genre-corrected ---
        def bucket_energy(hours_sql):
            try:
                row = raw_con.execute(
                    f"SELECT AVG({_ADJ_E}) {join} AND f.energy IS NOT NULL "
                    f"AND EXTRACT(hour FROM h.ts + to_minutes({off})) IN ({hours_sql})"
                ).fetchone()
            except Exception:
                return None
            return round(float(row[0]), 3) if row and row[0] is not None else None

        morning = bucket_energy("5, 6, 7, 8, 9, 10, 11")
        night = bucket_energy("21, 22, 23, 0, 1, 2, 3")
        day_night = {}
        if morning is not None:
            day_night["morning"] = {"energy": morning}
        if night is not None:
            day_night["night"] = {"energy": night}

        return {
            "genre_evolution": genre_evolution,
            "mood_trend": mood_trend,
            "day_night": day_night,
            "mainstream_trend": mainstream_trend,
        }

    res = await run_in_threadpool(query)
    if not res:
        return {
            "status": "ok",
            "year": yr,
            "genre_evolution": {"periods": [], "genres": []},
            "mood_trend": [],
            "day_night": {},
            "mainstream_trend": [],
        }
    return {"status": "ok", "year": yr, **res}


@router.get("/api/metrics/sound-detail")
async def get_sound_detail(year: str = "all", conn: Connection = Depends(get_db)):
    """Audio-detail spread and standouts for "The Detail In Your Sound": tempo
    distribution, major/minor (bright vs moody) split, most danceable tracks, and
    a high-vs-low energy (workout vs wind-down) split. From the enriched
    track_features slice; empty when unenriched → the frontend keeps its sample.
    """
    yr = _parse_year(year)

    _JOIN = (
        "FROM history h JOIN track_features f "
        "ON split_part(h.track_uri, ':', 3) = f.track_id "
        "WHERE h.track_uri LIKE 'spotify:track:%'"
    )
    _ADJ_E = (
        "CASE WHEN "
        "lower(split_part(f.artist_genres, ',', 1)) LIKE '%r&b%' "
        "OR lower(split_part(f.artist_genres, ',', 1)) LIKE '%soul%' "
        "OR lower(split_part(f.artist_genres, ',', 1)) LIKE '%hip hop%' "
        "OR lower(split_part(f.artist_genres, ',', 1)) LIKE '%rap%' "
        "OR lower(split_part(f.artist_genres, ',', 1)) LIKE '%trap%' "
        f"THEN greatest(0, f.energy - {_ENERGY_LOUDNESS_ADJ}) "
        "ELSE f.energy END"
    )

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con) if yr is not None else 0
        join = _JOIN + _year_clause(yr, off, "h.")

        # Tempo buckets (BPM → plain speed labels).
        try:
            row = raw_con.execute(
                "SELECT "
                "COUNT(*) FILTER (WHERE f.tempo < 90), "
                "COUNT(*) FILTER (WHERE f.tempo >= 90 AND f.tempo < 110), "
                "COUNT(*) FILTER (WHERE f.tempo >= 110 AND f.tempo < 130), "
                "COUNT(*) FILTER (WHERE f.tempo >= 130 AND f.tempo < 150), "
                "COUNT(*) FILTER (WHERE f.tempo >= 150), "
                "COUNT(*) FILTER (WHERE f.tempo IS NOT NULL) "
                + join
            ).fetchone()
        except Exception:
            return None
        if not row or not row[5]:
            return None
        labels = ["Slow", "Relaxed", "Steady", "Upbeat", "Fast"]
        buckets = [{"label": labels[i], "plays": int(row[i] or 0)} for i in range(5)]

        # Major / minor (bright vs moody).
        major_share = None
        try:
            m = raw_con.execute(
                "SELECT AVG(CASE WHEN f.mode = 1 THEN 1.0 ELSE 0.0 END) "
                + join + " AND f.mode IS NOT NULL"
            ).fetchone()[0]
            major_share = round(float(m), 3) if m is not None else None
        except Exception:
            major_share = None

        # Most danceable tracks the user actually plays.
        danceable = []
        try:
            drows = raw_con.execute(
                "SELECT split_part(h.track_uri, ':', 3) AS id, any_value(h.track_name), "
                "any_value(h.artist_name), any_value(f.danceability) AS dnc, COUNT(*) AS plays "
                + join + " AND h.track_name IS NOT NULL AND f.danceability IS NOT NULL "
                "GROUP BY id HAVING COUNT(*) >= 5 ORDER BY dnc DESC, plays DESC LIMIT 4"
            ).fetchall()
            danceable = [
                {"name": r[1], "artist": r[2] or "", "id": r[0], "danceability": round(float(r[3]), 3)}
                for r in drows
            ]
        except Exception:
            danceable = []

        # Workout (above-midpoint energy) vs wind-down, genre-corrected.
        energy_split = {}
        try:
            w = raw_con.execute(
                f"SELECT AVG((({_ADJ_E}) >= 0.5)::INTEGER) " + join + " AND f.energy IS NOT NULL"
            ).fetchone()[0]
            if w is not None:
                workout = round(float(w), 3)
                energy_split = {"workout": workout, "wind_down": round(1 - workout, 3)}
        except Exception:
            energy_split = {}

        return {
            "tempo": {"buckets": buckets},
            "key": {"major_share": major_share} if major_share is not None else {},
            "danceable": danceable,
            "energy_split": energy_split,
        }

    res = await run_in_threadpool(query)
    if not res:
        return {
            "status": "ok",
            "year": yr,
            "tempo": {"buckets": []},
            "key": {},
            "danceable": [],
            "energy_split": {},
        }
    return {"status": "ok", "year": yr, **res}


@router.get("/api/metrics/deep-cuts")
async def get_deep_cuts(year: str = "all", conn: Connection = Depends(get_db)):
    """Loyalty and commitment deep cuts (history only): the top 10 artists' share
    of plays, full-album vs single listening, the track binged most in one day,
    and the heavily-played favourite you almost never skip.
    """
    yr = _parse_year(year)

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con)  # int minutes; safe to inline
        clause = _year_clause(yr, off)
        music = (
            "WHERE track_uri LIKE 'spotify:track:%' AND artist_name IS NOT NULL" + clause
        )

        # Concentration: top 10 artists' share of music plays.
        try:
            row = raw_con.execute(
                f"""
                WITH artist_plays AS (
                    SELECT artist_name, COUNT(*) AS plays
                    FROM history {music} GROUP BY artist_name
                ), ranked AS (
                    SELECT plays, ROW_NUMBER() OVER (ORDER BY plays DESC) AS rn
                    FROM artist_plays
                )
                SELECT COALESCE(SUM(plays) FILTER (WHERE rn <= 10), 0), COALESCE(SUM(plays), 0)
                FROM ranked
                """
            ).fetchone()
        except Exception:
            return None
        if not row or not row[1]:
            return None
        top10_share = round(row[0] / row[1], 3)

        # Album commitment: share of played albums with >= 3 distinct tracks.
        deep_share = None
        try:
            r = raw_con.execute(
                f"""
                WITH album_tracks AS (
                    SELECT album_name, artist_name, COUNT(DISTINCT track_uri) AS distinct_tracks
                    FROM history
                    WHERE album_name IS NOT NULL AND track_uri LIKE 'spotify:track:%'{clause}
                    GROUP BY album_name, artist_name
                )
                SELECT AVG((distinct_tracks >= 3)::INTEGER) FROM album_tracks
                """
            ).fetchone()[0]
            deep_share = round(float(r), 3) if r is not None else None
        except Exception:
            deep_share = None

        # Most-played track in a single day (>= 30s plays only, so auto-repeat
        # skip-spam doesn't masquerade as a genuine binge).
        top_day_track = {}
        try:
            d = raw_con.execute(
                f"""
                SELECT CAST(ts + to_minutes({off}) AS DATE) AS day, track_uri,
                       any_value(track_name), any_value(artist_name), COUNT(*) AS plays
                FROM history
                WHERE track_uri LIKE 'spotify:track:%' AND ts IS NOT NULL
                  AND track_name IS NOT NULL AND ms_played >= 30000{clause}
                GROUP BY day, track_uri
                ORDER BY plays DESC, day
                LIMIT 1
                """
            ).fetchone()
            if d:
                day = d[0]
                top_day_track = {
                    "name": d[2],
                    "artist": d[3] or "",
                    "id": d[1].split(":")[-1],
                    "count": int(d[4]),
                    "date": f"{day.strftime('%B')} {day.day}, {day.year}",
                }
        except Exception:
            top_day_track = {}

        # The favourite you almost never skip (many plays, low fwdbtn rate).
        no_skip = {}
        try:
            def pick(min_plays):
                return raw_con.execute(
                    f"""
                    SELECT split_part(track_uri, ':', 3) AS id, any_value(track_name),
                           any_value(artist_name), COUNT(*) AS plays,
                           AVG(CASE WHEN reason_end = 'fwdbtn' THEN 1.0 ELSE 0.0 END) AS skip_rate
                    FROM history
                    WHERE track_uri LIKE 'spotify:track:%' AND track_name IS NOT NULL{clause}
                    GROUP BY track_uri HAVING COUNT(*) >= {min_plays}
                    ORDER BY skip_rate ASC, plays DESC LIMIT 1
                    """
                ).fetchone()

            n = pick(20) or pick(5)
            if n:
                no_skip = {
                    "name": n[1],
                    "artist": n[2] or "",
                    "id": n[0],
                    "plays": int(n[3]),
                    "skip_rate": round(float(n[4]), 3),
                }
        except Exception:
            no_skip = {}

        return {
            "concentration": {"top10_share": top10_share},
            "album_commitment": {"deep_share": deep_share} if deep_share is not None else {},
            "top_day_track": top_day_track,
            "no_skip": no_skip,
        }

    res = await run_in_threadpool(query)
    if not res:
        return {
            "status": "ok",
            "year": yr,
            "concentration": {},
            "album_commitment": {},
            "top_day_track": {},
            "no_skip": {},
        }
    return {"status": "ok", "year": yr, **res}


@router.get("/api/metrics/wrapped")
async def get_wrapped(year: str = "all", conn: Connection = Depends(get_db)):
    """Finale personality synthesis: traits from history (loyalty, chronotype,
    skip, shuffle) plus one catalog trait (mainstream, from track_features).
    """
    yr = _parse_year(year)

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con)  # int minutes; safe to inline
        clause = _year_clause(yr, off)
        hclause = _year_clause(yr, off, "h.")
        music = "WHERE track_uri LIKE 'spotify:track:%' AND ts IS NOT NULL" + clause

        # Discovery share (share of plays that are an artist's first month) — the
        # SAME signal Chapter 6 uses, so the Explorer/Loyalist trait agrees with it.
        try:
            row = raw_con.execute(
                f"""
                WITH plays AS (
                    SELECT artist_name, date_trunc('month', ts) AS month
                    FROM history WHERE artist_name IS NOT NULL AND ts IS NOT NULL{clause}
                ), first_month AS (
                    SELECT artist_name, MIN(month) AS first_month FROM plays GROUP BY artist_name
                )
                SELECT COALESCE(AVG((month = first_month)::INTEGER), 0), COUNT(*)
                FROM plays JOIN first_month USING (artist_name)
                """
            ).fetchone()
        except Exception:
            return None
        if not row or not row[1]:
            return None
        new_artist_share = float(row[0] or 0)

        # Chronotype from the hourly distribution.
        hourly = [0] * 24
        try:
            for h, c in raw_con.execute(
                f"SELECT EXTRACT(hour FROM ts + to_minutes({off}))::INTEGER AS h, COUNT(*) "
                f"FROM history {music} GROUP BY h"
            ).fetchall():
                if h is not None and 0 <= int(h) <= 23:
                    hourly[int(h)] = int(c)
        except Exception:
            pass
        chrono = _chronotype(hourly)

        # Skip + shuffle behaviour.
        try:
            beh = raw_con.execute(
                "SELECT AVG(CASE WHEN reason_end = 'fwdbtn' THEN 1.0 ELSE 0.0 END), "
                "AVG(CASE WHEN shuffle THEN 1.0 ELSE 0.0 END) "
                "FROM history WHERE track_uri LIKE 'spotify:track:%'" + clause
            ).fetchone()
            skip_rate = float(beh[0]) if beh and beh[0] is not None else 0.0
            shuffle = float(beh[1]) if beh and beh[1] is not None else 0.0
        except Exception:
            skip_rate, shuffle = 0.0, 0.0

        # Mainstream (catalog popularity).
        avg_pop = None
        try:
            p = raw_con.execute(
                "SELECT AVG(f.popularity) FROM history h JOIN track_features f "
                "ON split_part(h.track_uri, ':', 3) = f.track_id "
                "WHERE h.track_uri LIKE 'spotify:track:%' AND f.popularity IS NOT NULL"
                + hclause
            ).fetchone()[0]
            avg_pop = float(p) if p is not None else None
        except Exception:
            avg_pop = None

        def skip_label(s):
            return "Restless" if s >= 0.4 else "Selective" if s >= 0.2 else "Locked in"

        def shuffle_label(s):
            return "Shuffler" if s >= 0.6 else "A bit of both" if s >= 0.35 else "Curator"

        # Explorer/Loyalist uses Chapter 6's discoveryWord thresholds; position is
        # scaled (share rarely exceeds ~0.5) so the marker sits under the label.
        def discovery_label(s):
            return "Explorer" if s >= 0.45 else "Open to new music" if s >= 0.25 else "Loyalist"

        personality = [
            {
                "label": discovery_label(new_artist_share),
                "left": "Loyalist", "right": "Explorer",
                "position": round(min(1.0, new_artist_share / 0.5), 3), "icon": "explore",
            },
            {
                "label": chrono["label"] or "Balanced",
                "left": "Early bird", "right": "Night owl",
                "position": round(chrono["position"], 3), "icon": "bedtime",
            },
            {
                "label": skip_label(skip_rate),
                "left": "Restless", "right": "Focused",
                "position": round(1 - skip_rate, 3), "icon": "center_focus_strong",
            },
            {
                "label": shuffle_label(shuffle),
                "left": "Curator", "right": "Shuffler",
                "position": round(shuffle, 3), "icon": "shuffle",
            },
        ]
        if avg_pop is not None:
            personality.insert(1, {
                "label": "Mainstream" if avg_pop >= 0.5 else "Underground",
                "left": "Underground", "right": "Mainstream",
                "position": round(avg_pop, 3), "icon": "trending_up",
            })

        return {"personality": personality}

    res = await run_in_threadpool(query)
    if not res:
        return {"status": "ok", "year": yr, "personality": []}
    return {"status": "ok", "year": yr, **res}


# ── Charts: numbered leaderboards ─────────────────────────────────────────────
_CHART_SPECS = {
    "artist": {
        "select": "artist_name AS name, NULL AS artist, NULL AS id",
        "group": "artist_name",
        "where": "artist_name IS NOT NULL",
    },
    "track": {
        "select": (
            "any_value(track_name) AS name, any_value(artist_name) AS artist, "
            "split_part(track_uri, ':', 3) AS id"
        ),
        "group": "split_part(track_uri, ':', 3)",
        "where": "track_uri LIKE 'spotify:track:%' AND track_name IS NOT NULL",
    },
    "album": {
        "select": "album_name AS name, artist_name AS artist, NULL AS id",
        "group": "album_name, artist_name",
        "where": "album_name IS NOT NULL",
    },
}


def _chart_range_clause(rng: str, off: int) -> str:
    """History WHERE fragment for a range. `off`/year are internal ints → safe to inline."""
    if rng == "all":
        return ""
    if rng == "4w":
        return " AND ts >= (SELECT max(ts) FROM history) - to_days(28)"
    if rng == "6m":
        return " AND ts >= (SELECT max(ts) FROM history) - to_months(6)"
    return _year_clause(int(rng), off)


def _chart_rank_history(raw_con, entity, order_col, clause, limit):
    spec = _CHART_SPECS[entity]
    limit_sql = f" LIMIT {int(limit)}" if limit else ""
    if entity == "artist":
        # Merge stylized name variants (e.g. "Giveon" / "GIVĒON") under a
        # diacritic-insensitive key; show the most-played spelling.
        rows = raw_con.execute(
            "SELECT arg_max(name, vms) AS name, akey, "
            "SUM(vms) AS ms, SUM(vstreams) AS streams FROM ("
            "SELECT artist_name AS name, strip_accents(upper(trim(artist_name))) AS akey, "
            "SUM(ms_played) AS vms, COUNT(*) AS vstreams "
            f"FROM history WHERE artist_name IS NOT NULL{clause} GROUP BY name, akey) "
            f"GROUP BY akey ORDER BY {order_col} DESC, 1{limit_sql}"
        ).fetchall()
        return [
            {"name": r[0], "key": r[1], "artist": None, "id": None,
             "ms": int(r[2] or 0), "streams": int(r[3])}
            for r in rows
        ]

    rows = raw_con.execute(
        f"SELECT {spec['select']}, SUM(ms_played) AS ms, COUNT(*) AS streams "
        f"FROM history WHERE {spec['where']}{clause} "
        f"GROUP BY {spec['group']} ORDER BY {order_col} DESC, 1{limit_sql}"
    ).fetchall()
    out = []
    for r in rows:
        item = {"name": r[0], "artist": r[1], "id": r[2], "ms": int(r[3] or 0), "streams": int(r[4])}
        item["key"] = item["id"] if entity == "track" else (item["name"], item["artist"])
        out.append(item)
    return out


def _chart_rank_genre(raw_con, order_col, clause):
    join = (
        "FROM history h JOIN track_features f "
        "ON split_part(h.track_uri, ':', 3) = f.track_id "
        "WHERE h.track_uri LIKE 'spotify:track:%' "
        "AND f.artist_genres IS NOT NULL AND f.artist_genres <> ''"
    )
    rows = raw_con.execute(
        "SELECT lower(split_part(f.artist_genres, ',', 1)) AS g, "
        f"SUM(h.ms_played) AS ms, COUNT(*) AS streams {join}{clause} GROUP BY g"
    ).fetchall()
    buckets: dict = {}
    for raw, ms, streams in rows:
        label = _umbrella_genre(raw)
        if not label:
            continue
        b = buckets.setdefault(label, [0, 0])
        b[0] += int(ms or 0)
        b[1] += int(streams or 0)
    idx = 0 if order_col == "ms" else 1
    ranked = sorted(buckets.items(), key=lambda kv: kv[1][idx], reverse=True)
    return [
        {"name": name, "key": name, "artist": None, "id": None, "ms": v[0], "streams": v[1]}
        for name, v in ranked
    ]


def _chart_years(raw_con, off):
    try:
        return [
            int(r[0])
            for r in raw_con.execute(
                f"SELECT DISTINCT EXTRACT(year FROM ts + to_minutes({off}))::INTEGER AS y "
                "FROM history WHERE ts IS NOT NULL ORDER BY y DESC"
            ).fetchall()
        ]
    except Exception:
        return []


def _chart_attach_ids(raw_con, entity, items):
    """Fill artist_id / album_id from track_features so covers can lazy-load."""
    if entity in ("track", "genre"):
        return
    try:
        if entity == "artist":
            id_map = {
                r[0]: r[1]
                for r in raw_con.execute(
                    "SELECT strip_accents(upper(trim(artist_name))) AS akey, arg_max(artist_id, c) "
                    "FROM (SELECT artist_name, artist_id, COUNT(*) AS c FROM track_features "
                    "WHERE artist_id IS NOT NULL GROUP BY artist_name, artist_id) GROUP BY akey"
                ).fetchall()
            }
            for it in items:
                it["id"] = id_map.get(it["key"])
        else:  # album
            covers.attach_album_cover_refs(raw_con, items)
    except Exception:
        pass


@router.get("/api/metrics/chart")
async def get_chart(
    entity: str = "artist",
    sort: str = "minutes",
    limit: int = 100,
    range: str = "all",
    conn: Connection = Depends(get_db),
):
    """Numbered Top-N leaderboard for artist / track / album / genre, ranked by
    minutes or streams, over all time / a year / the last 4 weeks / 6 months.
    Genres need the enriched track_features slice → empty items when unenriched.
    """
    entity = entity.lower()
    sort = sort.lower()
    if entity not in ("artist", "track", "album", "genre"):
        raise HTTPException(status_code=400, detail="Invalid entity for chart.")
    if sort not in ("minutes", "streams"):
        raise HTTPException(status_code=400, detail="Invalid sort for chart.")
    rng = range.lower()
    if rng not in ("all", "4w", "6m") and not (rng.isdigit() and len(rng) == 4):
        raise HTTPException(status_code=400, detail="Invalid range for chart.")
    limit = max(1, min(int(limit), 200))
    order_col = "ms" if sort == "minutes" else "streams"

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con)
        clause = _chart_range_clause(rng, off)

        try:
            if entity == "genre":
                main = _chart_rank_genre(raw_con, order_col, clause)[:limit]
            else:
                main = _chart_rank_history(raw_con, entity, order_col, clause, limit)
        except Exception:
            return None

        if not main:
            return {"items": [], "years": _chart_years(raw_con, off)}

        _chart_attach_ids(raw_con, entity, main)

        # Previous-period ranks power ▲▼ movement; only defined for a given year.
        prev_map = {}
        if rng.isdigit():
            try:
                prev_clause = _chart_range_clause(str(int(rng) - 1), off)
                prev = (
                    _chart_rank_genre(raw_con, order_col, prev_clause)
                    if entity == "genre"
                    else _chart_rank_history(raw_con, entity, order_col, prev_clause, 0)
                )
                for i, it in enumerate(prev, start=1):
                    prev_map[it["key"]] = i
            except Exception:
                prev_map = {}

        max_val = main[0][order_col] or 1
        items = []
        for i, it in enumerate(main, start=1):
            items.append(
                {
                    "rank": i,
                    "name": it["name"],
                    "artist": it["artist"],
                    "id": it["id"],
                    "cover_kind": it.get("cover_kind"),
                    "cover_id": it.get("cover_id"),
                    "minutes": round(it["ms"] / 60000, 2),
                    "streams": it["streams"],
                    "share": round(it[order_col] / max_val, 4),
                    "prev_rank": prev_map.get(it["key"]),
                }
            )
        _attach_image_urls(raw_con, entity, items)
        return {"items": items, "years": _chart_years(raw_con, off)}

    res = await run_in_threadpool(query)
    base = {"status": "ok", "entity": entity, "sort": sort, "range": rng}
    if not res:
        return {**base, "items": [], "years": []}
    return {**base, **res}


# ── Superlatives: "Top-10 records" per year / all-time ────────────────────────
def _superlative_obsession(raw_con, off, clause, limit):
    """Tracks ranked by the most plays crammed into a single day. Only ≥30s
    plays count, so a skipped auto-repeat can't masquerade as an obsession.
    """
    try:
        rows = raw_con.execute(
            "SELECT arg_max(name, plays) AS name, arg_max(artist, plays) AS artist, id, "
            "max(plays) AS plays, arg_max(day, plays) AS day FROM ("
            "SELECT split_part(track_uri, ':', 3) AS id, "
            "any_value(track_name) AS name, any_value(artist_name) AS artist, "
            f"CAST(ts + to_minutes({off}) AS DATE) AS day, COUNT(*) AS plays "
            "FROM history WHERE track_uri LIKE 'spotify:track:%' AND track_name IS NOT NULL "
            f"AND ts IS NOT NULL AND ms_played >= 30000{clause} GROUP BY id, day) "
            f"GROUP BY id ORDER BY plays DESC, name LIMIT {int(limit)}"
        ).fetchall()
    except Exception:
        return []
    return [
        {"rank": i, "name": r[0], "artist": r[1], "id": r[2], "count": int(r[3]), "date": str(r[4])}
        for i, r in enumerate(rows, start=1)
    ]


def _superlative_binges(raw_con, off, clause, limit):
    """Longest single-sitting sessions (a >30-min gap starts a new session),
    with the artist you leaned on most and their share of the session.
    """
    try:
        rows = raw_con.execute(
            "WITH o AS ("
            "  SELECT ts, artist_name, LAG(ts) OVER (ORDER BY ts) AS prev "
            "  FROM history WHERE ts IS NOT NULL AND track_uri LIKE 'spotify:track:%'" + clause +
            "), m AS ("
            "  SELECT ts, artist_name, "
            "         CASE WHEN prev IS NULL OR date_diff('minute', prev, ts) > 30 THEN 1 ELSE 0 END AS ns "
            "  FROM o"
            "), s AS ("
            "  SELECT ts, artist_name, SUM(ns) OVER (ORDER BY ts) AS sid FROM m"
            "), ac AS ("
            "  SELECT sid, artist_name, COUNT(*) AS c FROM s GROUP BY sid, artist_name"
            "), top AS ("
            "  SELECT sid, arg_max(artist_name, c) AS top_artist, MAX(c) AS top_count FROM ac GROUP BY sid"
            "), sess AS ("
            "  SELECT sid, date_diff('minute', MIN(ts), MAX(ts)) AS dur, "
            f"         CAST(MIN(ts) + to_minutes({off}) AS DATE) AS day, COUNT(*) AS plays "
            "  FROM s GROUP BY sid"
            ") SELECT sess.dur, sess.day, sess.plays, top.top_artist, top.top_count "
            "FROM sess JOIN top USING (sid) WHERE sess.dur >= 20 "
            f"ORDER BY sess.dur DESC, sess.day LIMIT {int(limit)}"
        ).fetchall()
    except Exception:
        return []
    items = [
        {"rank": i, "name": r[3], "minutes": int(r[0]), "date": str(r[1]),
         "plays": int(r[2]), "artist_pct": round(r[4] / r[2] * 100) if r[2] else 0}
        for i, r in enumerate(rows, start=1)
    ]
    _attach_binge_artist_ids(raw_con, items)
    return items


def _attach_binge_artist_ids(raw_con, items):
    """Set each binge's `id` to its artist photo id, matched by the artist NAME
    shown (accent-insensitive), so the cover always matches the label. A binge
    is an artist's session, so we show the artist — not a track cover. Stays
    None when unenriched or the artist isn't in the catalog.
    """
    for it in items:
        it["id"] = None
    if not items:
        return
    try:
        id_map = {
            r[0]: r[1]
            for r in raw_con.execute(
                "SELECT strip_accents(upper(trim(artist_name))) AS akey, arg_max(artist_id, c) "
                "FROM (SELECT artist_name, artist_id, COUNT(*) AS c FROM track_features "
                "WHERE artist_id IS NOT NULL GROUP BY artist_name, artist_id) GROUP BY akey"
            ).fetchall()
        }
    except Exception:
        return
    for it in items:
        it["id"] = id_map.get(_norm_artist_key(it.get("name")))


def _norm_artist_key(name):
    """Mirror DuckDB strip_accents(upper(trim(name))) for id-map lookups."""
    s = (name or "").strip().upper()
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


def _skip_stats(raw_con, clause):
    """Per-track play + explicit-skip (reason_end='fwdbtn') counts."""
    try:
        return raw_con.execute(
            "SELECT split_part(track_uri, ':', 3) AS id, any_value(track_name) AS name, "
            "any_value(artist_name) AS artist, COUNT(*) AS plays, "
            "SUM(CASE WHEN reason_end = 'fwdbtn' THEN 1 ELSE 0 END) AS skips "
            "FROM history WHERE track_uri LIKE 'spotify:track:%' AND track_name IS NOT NULL"
            + clause + " GROUP BY id"
        ).fetchall()
    except Exception:
        return []


def _superlative_most_skipped(skip_rows, limit):
    """Tracks you press next on most, ranked by skip rate (min 5 plays)."""
    cand = [r for r in skip_rows if r[3] >= 5 and r[4] >= 1]
    cand.sort(key=lambda r: (r[4] / r[3], r[3]), reverse=True)
    return [
        {"rank": i, "name": r[1], "artist": r[2], "id": r[0],
         "plays": int(r[3]), "skip_pct": round(r[4] / r[3] * 100)}
        for i, r in enumerate(cand[:limit], start=1)
    ]


def _superlative_never_skipped(skip_rows, limit):
    """Most-played tracks you never once skipped (min 10 plays, 0 skips)."""
    cand = [r for r in skip_rows if r[3] >= 10 and r[4] == 0]
    cand.sort(key=lambda r: r[3], reverse=True)
    return [
        {"rank": i, "name": r[1], "artist": r[2], "id": r[0], "plays": int(r[3])}
        for i, r in enumerate(cand[:limit], start=1)
    ]


@router.get("/api/metrics/superlatives")
async def get_superlatives(
    range: str = "all",
    limit: int = 10,
    conn: Connection = Depends(get_db),
):
    """History-only "records" for the Charts superlatives section, viewable
    per year or all-time: obsession, binges, most/never skipped."""
    rng = range.lower()
    if rng not in ("all", "4w", "6m") and not (rng.isdigit() and len(rng) == 4):
        raise HTTPException(status_code=400, detail="Invalid range for superlatives.")
    limit = max(1, min(int(limit), 50))

    def query():
        raw_con = conn.connection.driver_connection
        off = _tz_offset_minutes(raw_con)
        clause = _chart_range_clause(rng, off)
        skip_rows = _skip_stats(raw_con, clause)
        return {
            "obsession": _superlative_obsession(raw_con, off, clause, limit),
            "binges": _superlative_binges(raw_con, off, clause, limit),
            "most_skipped": _superlative_most_skipped(skip_rows, limit),
            "never_skipped": _superlative_never_skipped(skip_rows, limit),
            "years": _chart_years(raw_con, off),
        }

    res = await run_in_threadpool(query)
    return {"status": "ok", "range": rng, **res}
