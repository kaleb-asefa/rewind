"""Pure computation helpers for the metrics endpoints.

Everything here is framework-free (no FastAPI) so it can be unit-tested and
reused across routers: rank smoothing, bar-race accumulation, heatmap levels,
listening streaks, chronotype, timezone resolution and genre bucketing.
"""

import os
from datetime import date, timedelta


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


_WEEKDAY_NAMES = {
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
    7: "Sunday",
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


# Spotify stores `ts` in UTC. Localize per user by their dominant conn_country so
# the clock/weekday/heatmap read as wall-clock. Env REWIND_TZ_OFFSET_HOURS forces a
# fixed offset; otherwise fall back to UTC. Offsets in MINUTES (half-hour zones exist).
_ENV_TZ_HOURS = os.getenv("REWIND_TZ_OFFSET_HOURS")
_COUNTRY_TZ_MIN = {
    "GB": 0, "IE": 0, "PT": 0, "IS": 0, "GH": 0, "SN": 0, "CI": 0,
    "NG": 60, "DE": 60, "FR": 60, "ES": 60, "IT": 60, "NL": 60, "BE": 60,
    "SE": 60, "NO": 60, "DK": 60, "PL": 60, "CH": 60, "AT": 60, "CZ": 60,
    "HU": 60, "DZ": 60, "MA": 60,
    "ZA": 120, "EG": 120, "GR": 120, "FI": 120, "RO": 120, "UA": 120,
    "IL": 120, "BG": 120,
    "ET": 180, "KE": 180, "TZ": 180, "UG": 180, "SA": 180, "TR": 180,
    "RU": 180, "IQ": 180, "QA": 180, "KW": 180,
    "IR": 210, "AE": 240, "AZ": 240, "GE": 240,
    "PK": 300, "IN": 330, "LK": 330, "NP": 345, "BD": 360,
    "TH": 420, "VN": 420, "ID": 420,
    "SG": 480, "MY": 480, "PH": 480, "CN": 480, "HK": 480, "TW": 480,
    "JP": 540, "KR": 540,
    "AU": 600, "NZ": 780,
    "BR": -180, "AR": -180, "CL": -180, "UY": -180,
    "US": -300, "CA": -300, "CO": -300, "PE": -300, "EC": -300,
    "MX": -360, "CR": -360, "GT": -360,
}


def _tz_offset_minutes(raw_con) -> int:
    """Minutes to add to UTC `ts` for this session's local wall-clock time.

    Priority: REWIND_TZ_OFFSET_HOURS override → dominant conn_country → UTC(0).
    """
    if _ENV_TZ_HOURS is not None:
        try:
            return int(round(float(_ENV_TZ_HOURS) * 60))
        except ValueError:
            pass
    try:
        row = raw_con.execute(
            "SELECT conn_country FROM history WHERE conn_country IS NOT NULL "
            "GROUP BY conn_country ORDER BY COUNT(*) DESC LIMIT 1"
        ).fetchone()
    except Exception:
        row = None
    return _COUNTRY_TZ_MIN.get(row[0] if row else None, 0)


# Spotify's "energy" is largely a loudness/production proxy — its own docs list
# "perceived loudness" and "dynamic range" as inputs, and public audio-feature
# analyses put the energy<->loudness correlation around 0.7-0.8. Hip-hop, rap, trap,
# R&B and soul are the most brick-walled / compressed genres (the "loudness war"),
# so their energy reads systematically high even for mellow songs. On real data that
# inflation is ~0.10-0.15 on the 0-1 scale; 0.12 is the single value that pulls chill
# tracks back to the calm half without flipping genuinely energetic tracks out of it.
# Applied only to these genres (a global shift would wrongly drag pop/latin/EDM down).
_ENERGY_LOUDNESS_ADJ = 0.12


# Spotify's raw genre tags are hyper-granular ("north carolina hip hop"); fold the
# primary tag into a handful of everyday buckets for a readable breakdown. First
# match wins, so order matters (specific before generic; "pop" before "dance").
_GENRE_RULES = [
    ("K-Pop", ("k-pop", "korean")),
    ("Afrobeats", ("amapiano", "afrobeat", "afropop", "afro house", "afro-fusion", "alte")),
    ("Latin", ("reggaeton", "urbano", "latin", "bachata", "salsa", "cumbia", "corrido", "banda", "regional mexican", "mariachi")),
    ("Reggae", ("reggae", "dancehall")),
    ("Hip-Hop", ("hip hop", "hip-hop", "rap", "trap", "drill", "grime")),
    ("R&B", ("r&b", "rnb", "r & b", "soul", "funk", "motown", "urban contemporary")),
    ("Country", ("country", "americana", "bluegrass")),
    ("Jazz", ("jazz", "blues", "bossa nova")),
    ("Classical", ("classical", "orchestra", "composer", "baroque", "opera", "soundtrack", "score")),
    ("Rock", ("rock", "metal", "punk", "grunge", "emo", "hardcore")),
    ("Pop", ("pop", "alt z")),
    ("Electronic", ("edm", "house", "techno", "trance", "dubstep", "electro", "drum and bass", "dnb", "garage", "future bass", "electronic", "dance")),
    ("Indie", ("indie", "alternative")),
    ("Singer-Songwriter", ("singer-songwriter", "singer songwriter")),
    ("Gospel", ("gospel", "worship", "christian")),
]


def _umbrella_genre(raw: str) -> str:
    """Fold a granular Spotify genre tag into a broad, readable bucket; keep the
    raw tag (title-cased) when nothing matches rather than lumping to 'Other'."""
    g = (raw or "").strip().lower()
    if not g:
        return ""
    for label, keys in _GENRE_RULES:
        if any(k in g for k in keys):
            return label
    return g.title()
