"""Cover-art cache: fetch Spotify oEmbed thumbnails on demand, cache per session.

oEmbed needs no API key. A track's cover is its album cover; artist/album return
their own images. Results (including misses, stored as '') are cached in the session
DB so a cover is fetched from Spotify at most once.
"""

import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone

OEMBED_URL = "https://open.spotify.com/oembed"
_VALID_KINDS = {"artist", "album", "track"}


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

    try:
        url = _fetch_thumbnail(kind, spotify_id)
    except Exception:
        url = None

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
