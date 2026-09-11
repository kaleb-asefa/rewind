"""Cover identity: which Spotify id represents an entity's artwork.

``images.py`` fetches and caches art for a ``(kind, spotify_id)`` pair. This module
answers the question one step earlier — *which* id to ask for — for the entities
whose id is not already in the user's upload.

Tracks are trivial: ``history.track_uri`` is the id. Albums are not, and that is
where covers used to go missing. The old lookup matched
``(history.album_name, history.artist_name)`` against
``(track_features.album_name, track_features.artist_name)`` by exact string equality,
i.e. it compared two independently-produced name strings: Spotify's export vs. the
catalog parquet. They disagree routinely — edition suffixes ("Take Care" vs
"Take Care (Deluxe)"), casing and diacritics ("Giveon" vs "GIVĒON") — and every
disagreement silently yielded a NULL id, so no cover was ever requested.

Resolution here is identity-based instead, in two tiers:

1. ``history.track_uri`` -> ``track_features.track_id`` -> ``album_id``. An exact
   key join, so names never enter into it. Where a title maps to several catalog
   albums, the most-played one wins (the edition actually listened to) rather than
   an arbitrary ``MAX()``.
2. When the catalog has no row for any of the album's tracks — a release newer
   than the catalog snapshot — fall back to a representative ``track_id`` from the
   album. A track's oEmbed thumbnail *is* its album cover, so the artwork is still
   correct; only the id kind differs. This tier needs no catalog at all.

Callers therefore get ``(kind, spotify_id)``, not a bare album id.
"""

# Tier 1 + tier 2 in one pass. ``plays`` collapses history to one row per
# (album, artist, track); ``by_album`` re-weights catalog album ids by the
# listening time behind them so the most-played edition wins; ``rep_track``
# carries the tier-2 fallback. The final join is NULL-safe because
# ``history.artist_name`` is nullable.
_ALBUM_REFS_SQL = """
WITH plays AS (
    SELECT album_name,
           artist_name,
           split_part(track_uri, ':', 3) AS track_id,
           SUM(ms_played) AS ms
    FROM history
    WHERE album_name IS NOT NULL AND track_uri LIKE 'spotify:track:%'
    GROUP BY album_name, artist_name, track_id
),
joined AS (
    SELECT p.album_name, p.artist_name, p.track_id, p.ms, f.album_id
    FROM plays p
    LEFT JOIN track_features f ON f.track_id = p.track_id
),
by_album AS (
    SELECT album_name, artist_name, album_id, SUM(ms) AS ms
    FROM joined
    WHERE album_id IS NOT NULL
    GROUP BY album_name, artist_name, album_id
),
best_album AS (
    SELECT album_name, artist_name, arg_max(album_id, ms) AS album_id
    FROM by_album
    GROUP BY album_name, artist_name
),
rep_track AS (
    SELECT album_name, artist_name, arg_max(track_id, ms) AS track_id, SUM(ms) AS ms
    FROM joined
    GROUP BY album_name, artist_name
)
SELECT r.album_name, r.artist_name, a.album_id, r.track_id
FROM rep_track r
LEFT JOIN best_album a
       ON a.album_name IS NOT DISTINCT FROM r.album_name
      AND a.artist_name IS NOT DISTINCT FROM r.artist_name
ORDER BY r.ms DESC
"""

# Catalog-free variant: used when ``track_features`` does not exist (no catalog),
# so albums still get tier-2 track covers instead of nothing at all.
_ALBUM_REFS_FALLBACK_SQL = """
SELECT album_name, artist_name, NULL AS album_id,
       arg_max(track_id, ms) AS track_id
FROM (
    SELECT album_name, artist_name,
           split_part(track_uri, ':', 3) AS track_id,
           SUM(ms_played) AS ms
    FROM history
    WHERE album_name IS NOT NULL AND track_uri LIKE 'spotify:track:%'
    GROUP BY album_name, artist_name, track_id
)
GROUP BY album_name, artist_name
ORDER BY SUM(ms) DESC
"""


def album_cover_refs(raw_con) -> dict[tuple, tuple[str | None, str, str]]:
    """``{(album_name, artist_name): (album_id, cover_kind, cover_id)}``.

    ``album_id`` is the real Spotify album id, or None when the catalog has no row
    for any track on the album. ``cover_kind``/``cover_id`` are what to hand to
    :mod:`images` — the album id when known, otherwise a representative track id
    whose thumbnail is the same artwork. Best-effort: an empty dict on any failure.
    """
    try:
        rows = raw_con.execute(_ALBUM_REFS_SQL).fetchall()
    except Exception:
        try:
            rows = raw_con.execute(_ALBUM_REFS_FALLBACK_SQL).fetchall()
        except Exception:
            return {}

    refs: dict[tuple, tuple[str | None, str, str]] = {}
    for album_name, artist_name, album_id, track_id in rows:
        if album_id:
            refs[(album_name, artist_name)] = (album_id, "album", album_id)
        elif track_id:
            refs[(album_name, artist_name)] = (None, "track", track_id)
    return refs


def attach_album_cover_refs(raw_con, items, name_key="name", artist_key="artist"):
    """Set ``id`` / ``cover_kind`` / ``cover_id`` on album items in place.

    ``id`` stays the true album id (None when unknown) so existing consumers keep
    their meaning; ``cover_id`` is the id that actually resolves to artwork.
    """
    refs = album_cover_refs(raw_con)
    for it in items:
        album_id, kind, cover_id = refs.get(
            (it.get(name_key), it.get(artist_key)), (None, None, None)
        )
        it["id"] = album_id
        it["cover_kind"] = kind
        it["cover_id"] = cover_id


def album_fallback_track_ids(raw_con, limit: int = 50) -> list[str]:
    """Representative track ids for the most-played albums that have no catalog
    ``album_id`` — the tier-2 covers worth pre-warming alongside the album ids.

    :func:`album_cover_refs` yields albums most-played first, so this is a top-N.
    """
    refs = album_cover_refs(raw_con)
    return [cover_id for album_id, kind, cover_id in refs.values() if kind == "track"][
        :limit
    ]
