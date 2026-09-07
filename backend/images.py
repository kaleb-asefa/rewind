"""Cover-art cache: fetch Spotify oEmbed thumbnails on demand, cache per session.

oEmbed needs no API key. A track's cover is its album cover; artist/album return
their own images. Results (including misses, stored as '') are cached in the session
DB so a cover is fetched from Spotify at most once.
"""

import json
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

OEMBED_URL = "https://open.spotify.com/oembed"
_VALID_KINDS = {"artist", "album", "track"}
_MAX_WORKERS = 8  # concurrent oEmbed fetches per batch (network-bound, no DB access)


def _ensure_table(raw_con):
    raw_con.execute(
        """
        CREATE TABLE IF NOT EXISTS images (
            kind        VARCHAR,
            spotify_id  VARCHAR,
            image_url   VARCHAR,
            fetched_at  TIMESTAMP,
            PRIMARY KEY (kind, spotify_id)
        )
        """
    )


def _fetch_thumbnail(kind: str, spotify_id: str) -> str | None:
    page = f"https://open.spotify.com/{kind}/{spotify_id}"
    url = f"{OEMBED_URL}?url=" + urllib.parse.quote(page, safe="")
    req = urllib.request.Request(url, headers={"User-Agent": "Rewind/1.0"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.load(resp).get("thumbnail_url")


def _safe_fetch(kind: str, spotify_id: str) -> tuple[bool, str | None]:
    """Fetch one thumbnail. Returns (fetched_ok, url).

    fetched_ok is False only on a transient error (network/timeout/rate-limit),
    so the caller can skip caching it and let a later load retry. A successful
    response with no image returns (True, None) — a genuine miss worth caching.
    """
    try:
        return True, _fetch_thumbnail(kind, spotify_id)
    except Exception:
        return False, None


def get_or_fetch(raw_con, kind: str, spotify_id: str) -> str | None:
    """Return a cached cover URL, fetching + caching from oEmbed on a miss."""
    if kind not in _VALID_KINDS or not spotify_id:
        return None
    _ensure_table(raw_con)

    cached = raw_con.execute(
        "SELECT image_url FROM images WHERE kind = ? AND spotify_id = ?",
        [kind, spotify_id],
    ).fetchone()
    if cached is not None:
        return cached[0] or None

    ok, url = _safe_fetch(kind, spotify_id)
    if not ok:
        return None  # transient failure — don't cache, allow a later retry

    raw_con.execute(
        """
        INSERT INTO images (kind, spotify_id, image_url, fetched_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (kind, spotify_id) DO UPDATE SET
            image_url = excluded.image_url,
            fetched_at = excluded.fetched_at
        """,
        [kind, spotify_id, url or "", datetime.now(timezone.utc)],
    )
    return url


def get_or_fetch_many(raw_con, kind: str, ids: list[str]) -> dict[str, str | None]:
    """Resolve many cover URLs at once: one cache read, concurrent oEmbed fetch
    for the misses, one bulk write. Returns {spotify_id: url_or_None}.
    """
    if kind not in _VALID_KINDS:
        return {}
    ids = [i for i in dict.fromkeys(ids) if i]  # dedupe, drop blanks, keep order
    if not ids:
        return {}
    _ensure_table(raw_con)

    placeholders = ",".join("?" * len(ids))
    cached = {
        row[0]: row[1]
        for row in raw_con.execute(
            f"SELECT spotify_id, image_url FROM images "
            f"WHERE kind = ? AND spotify_id IN ({placeholders})",
            [kind, *ids],
        ).fetchall()
    }

    missing = [i for i in ids if i not in cached]
    fetched: dict[str, str | None] = {}
    if missing:
        with ThreadPoolExecutor(max_workers=min(_MAX_WORKERS, len(missing))) as pool:
            results = list(zip(missing, pool.map(lambda s: _safe_fetch(kind, s), missing)))
        now = datetime.now(timezone.utc)
        to_write = []
        for sid, (ok, url) in results:
            fetched[sid] = url if ok else None
            if ok:  # only persist definitive results, never transient failures
                to_write.append([kind, sid, url or "", now])
        if to_write:
            raw_con.executemany(
                "INSERT INTO images (kind, spotify_id, image_url, fetched_at) "
                "VALUES (?, ?, ?, ?) "
                "ON CONFLICT (kind, spotify_id) DO UPDATE SET "
                "image_url = excluded.image_url, fetched_at = excluded.fetched_at",
                to_write,
            )

    return {i: (cached.get(i) if i in cached else fetched.get(i)) or None for i in ids}
