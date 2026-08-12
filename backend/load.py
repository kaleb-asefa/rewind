"""
Song metadata enrichment pipeline for Rewind.

Two-phase auto-enrichment after upload:
  Phase 1 (fast): Bulk audio features + genre from Embeat 45M HuggingFace dataset
                   via DuckDB httpfs — no download, remote Parquet queries.
  Phase 2 (rate-limited, background): Images from Spotify oEmbed API,
                   release dates from Deezer API.

All results cached in a shared persistent metadata.duckdb that grows across users.
Only queries external sources for tracks/artists/albums NOT already in the cache.
"""

import json
import logging
import os
import time
import urllib.parse
import urllib.request

import duckdb

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")
METADATA_DB_PATH = os.path.join(DATA_DIR, "metadata.duckdb")
GENRE_MAP_PATH = os.path.join(DATA_DIR, "artist_genre_map.json")

# Embeat parquet files on HuggingFace (gated — requires HF token)
EMBEAT_PARQUET_URLS = [
    "https://huggingface.co/api/datasets/GD-Studio/embeat_45m_spotify_tracks/parquet/default/train/0.parquet",
    "https://huggingface.co/api/datasets/GD-Studio/embeat_45m_spotify_tracks/parquet/default/train/1.parquet",
    "https://huggingface.co/api/datasets/GD-Studio/embeat_45m_spotify_tracks/parquet/default/train/2.parquet",
]

SPOTIFY_OEMBED_URL = "https://open.spotify.com/oembed"
DEEZER_SEARCH_URL = "https://api.deezer.com/search/track"
DEEZER_ALBUM_URL = "https://api.deezer.com/album"

# Rate limits
OEMBED_DELAY = 0.1  # 10 req/sec (conservative — no documented limit)
DEEZER_DELAY = 0.1  # 10 req/sec (official: 50/5s)

# Batch size for DuckDB IN clause
BATCH_SIZE = 500


# ---------------------------------------------------------------------------
# Metadata DB setup
# ---------------------------------------------------------------------------


def get_metadata_conn() -> duckdb.DuckDBPyConnection:
    """Get or create the shared persistent metadata database connection."""
    os.makedirs(os.path.dirname(METADATA_DB_PATH), exist_ok=True)
    conn = duckdb.connect(METADATA_DB_PATH)
    _ensure_metadata_tables(conn)
    return conn


def _ensure_metadata_tables(conn: duckdb.DuckDBPyConnection):
    """Create metadata tables if they don't exist."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS track_metadata (
            track_id           VARCHAR PRIMARY KEY,
            track_name         VARCHAR,
            artist_name        VARCHAR,
            popularity         INTEGER,
            duration_ms        BIGINT,
            danceability       DOUBLE,
            energy             DOUBLE,
            valence            DOUBLE,
            tempo              DOUBLE,
            key                INTEGER,
            mode               INTEGER,
            acousticness       DOUBLE,
            instrumentalness   DOUBLE,
            liveness           DOUBLE,
            loudness           DOUBLE,
            speechiness        DOUBLE,
            time_signature     INTEGER,
            genre              VARCHAR,
            image_url          VARCHAR,
            release_date       VARCHAR
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS artist_metadata (
            artist_name        VARCHAR PRIMARY KEY,
            image_url          VARCHAR
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS album_metadata (
            album_name         VARCHAR,
            artist_name        VARCHAR,
            image_url          VARCHAR,
            release_date       VARCHAR,
            PRIMARY KEY (album_name, artist_name)
        )
    """)


# ---------------------------------------------------------------------------
# Phase 1: Bulk audio features from Embeat via DuckDB httpfs
# ---------------------------------------------------------------------------


def _load_genre_map(hf_token: str | None = None) -> dict[int, str]:
    """Load or download the artist_genre_map.json from Embeat."""
    if os.path.exists(GENRE_MAP_PATH):
        with open(GENRE_MAP_PATH) as f:
            raw = json.load(f)
        # Keys are string ints, convert to int -> str
        return {int(k): v for k, v in raw.items()}

    if not hf_token:
        logger.warning("No HF token — cannot download genre map. Genre will be NULL.")
        return {}

    url = "https://huggingface.co/datasets/GD-Studio/embeat_45m_spotify_tracks/resolve/main/artist_genre_map.json"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {hf_token}"})
    try:
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
        os.makedirs(os.path.dirname(GENRE_MAP_PATH), exist_ok=True)
        with open(GENRE_MAP_PATH, "wb") as f:
            f.write(data)
        raw = json.loads(data)
        return {int(k): v for k, v in raw.items()}
    except Exception as e:
        logger.error(f"Failed to download genre map: {e}")
        return {}


def _extract_track_ids(session_conn: duckdb.DuckDBPyConnection) -> list[str]:
    """Extract unique Spotify track IDs from session history."""
    try:
        rows = session_conn.execute("""
            SELECT DISTINCT
                REPLACE(track_uri, 'spotify:track:', '') AS track_id
            FROM history
            WHERE track_uri IS NOT NULL
              AND track_uri LIKE 'spotify:track:%'
        """).fetchall()
        return [row[0] for row in rows]
    except Exception as e:
        logger.error(f"Failed to extract track IDs from history: {e}")
        return []


def _get_cached_track_ids(meta_conn: duckdb.DuckDBPyConnection) -> set[str]:
    """Get set of track IDs already in the metadata cache."""
    try:
        rows = meta_conn.execute(
            "SELECT track_id FROM track_metadata"
        ).fetchall()
        return {row[0] for row in rows}
    except Exception:
        return set()


def enrich_audio_features(
    session_conn: duckdb.DuckDBPyConnection,
    meta_conn: duckdb.DuckDBPyConnection,
    hf_token: str | None = None,
) -> dict:
    """
    Phase 1: Query Embeat dataset via httpfs for audio features, duration, genre.
    Only fetches tracks not already in the metadata cache.

    Returns stats dict with keys: total_unique, already_cached, queried, matched.
    """
    all_track_ids = _extract_track_ids(session_conn)
    if not all_track_ids:
        return {"total_unique": 0, "already_cached": 0, "queried": 0, "matched": 0}

    cached_ids = _get_cached_track_ids(meta_conn)
    missing_ids = [tid for tid in all_track_ids if tid not in cached_ids]

    stats = {
        "total_unique": len(all_track_ids),
        "already_cached": len(cached_ids & set(all_track_ids)),
        "queried": len(missing_ids),
        "matched": 0,
    }

    if not missing_ids:
        logger.info("All tracks already cached — skipping Embeat query.")
        return stats

    if not hf_token:
        logger.warning("No HF token provided — cannot query Embeat dataset.")
        return stats

    # Load genre mapping
    genre_map = _load_genre_map(hf_token)

    # Install and load httpfs extension in metadata connection
    meta_conn.execute("INSTALL httpfs; LOAD httpfs;")
    meta_conn.execute(f"""
        CREATE SECRET IF NOT EXISTS hf_token (
            TYPE HUGGINGFACE,
            TOKEN '{hf_token}'
        )
    """)

    # Build the parquet source — union all 3 files
    parquet_sources = ", ".join(f"'{url}'" for url in EMBEAT_PARQUET_URLS)

    total_matched = 0

    # Process in batches to avoid enormous IN clauses
    for i in range(0, len(missing_ids), BATCH_SIZE):
        batch = missing_ids[i : i + BATCH_SIZE]
        placeholders = ", ".join(f"'{tid}'" for tid in batch)

        try:
            rows = meta_conn.execute(f"""
                SELECT
                    track_id,
                    track_name,
                    popularity,
                    duration_ms,
                    danceability,
                    energy,
                    valence,
                    tempo,
                    key,
                    mode,
                    acousticness,
                    instrumentalness,
                    liveness,
                    loudness,
                    speechiness,
                    time_signature,
                    artist_genre_idx
                FROM read_parquet([{parquet_sources}])
                WHERE track_id IN ({placeholders})
            """).fetchall()
        except Exception as e:
            logger.error(f"Embeat query failed for batch {i // BATCH_SIZE}: {e}")
            continue

        # Insert into metadata cache with genre resolution
        for row in rows:
            (
                track_id, track_name, popularity, duration_ms,
                danceability, energy, valence, tempo,
                key, mode, acousticness, instrumentalness,
                liveness, loudness, speechiness, time_signature,
                artist_genre_idx,
            ) = row

            genre = genre_map.get(artist_genre_idx) if artist_genre_idx is not None else None

            meta_conn.execute("""
                INSERT OR IGNORE INTO track_metadata (
                    track_id, track_name, popularity, duration_ms,
                    danceability, energy, valence, tempo,
                    key, mode, acousticness, instrumentalness,
                    liveness, loudness, speechiness, time_signature,
                    genre
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                track_id, track_name, popularity, duration_ms,
                danceability, energy, valence, tempo,
                key, mode, acousticness, instrumentalness,
                liveness, loudness, speechiness, time_signature,
                genre,
            ])
            total_matched += 1

        logger.info(
            f"Embeat batch {i // BATCH_SIZE + 1}: "
            f"queried {len(batch)}, matched {len(rows)}"
        )

    stats["matched"] = total_matched
    return stats


# ---------------------------------------------------------------------------
# Phase 2a: Images from Spotify oEmbed API
# ---------------------------------------------------------------------------


def _fetch_oembed_image(spotify_type: str, spotify_id: str) -> str | None:
    """
    Fetch thumbnail URL from Spotify oEmbed API.
    spotify_type: 'track', 'artist', or 'album'
    spotify_id: Spotify ID (not full URI)
    """
    spotify_url = f"https://open.spotify.com/{spotify_type}/{spotify_id}"
    encoded_url = urllib.parse.quote(spotify_url, safe="")
    oembed_url = f"{SPOTIFY_OEMBED_URL}?url={encoded_url}"

    try:
        req = urllib.request.Request(
            oembed_url,
            headers={"User-Agent": "Rewind/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        return data.get("thumbnail_url")
    except Exception as e:
        logger.debug(f"oEmbed failed for {spotify_type}/{spotify_id}: {e}")
        return None


def enrich_images(
    session_conn: duckdb.DuckDBPyConnection,
    meta_conn: duckdb.DuckDBPyConnection,
) -> dict:
    """
    Phase 2a: Fetch track/artist/album images via Spotify oEmbed.
    Only fetches for entities missing image_url in the cache.

    Returns stats dict.
    """
    stats = {"tracks": 0, "artists": 0, "albums": 0}

    # --- Track images (album art for the track) ---
    try:
        tracks_needing_images = meta_conn.execute("""
            SELECT tm.track_id
            FROM track_metadata tm
            WHERE tm.image_url IS NULL
              AND tm.track_id IN (
                  SELECT DISTINCT REPLACE(track_uri, 'spotify:track:', '')
                  FROM rewind_session.history
                  WHERE track_uri IS NOT NULL
                    AND track_uri LIKE 'spotify:track:%'
              )
        """).fetchall()
    except Exception:
        # If session DB not attached, get all tracks missing images
        tracks_needing_images = meta_conn.execute(
            "SELECT track_id FROM track_metadata WHERE image_url IS NULL"
        ).fetchall()

    for (track_id,) in tracks_needing_images:
        image_url = _fetch_oembed_image("track", track_id)
        if image_url:
            meta_conn.execute(
                "UPDATE track_metadata SET image_url = ? WHERE track_id = ?",
                [image_url, track_id],
            )
            stats["tracks"] += 1
        time.sleep(OEMBED_DELAY)

    # --- Artist images ---
    try:
        artists_needing_images = session_conn.execute("""
            SELECT DISTINCT artist_name
            FROM history
            WHERE artist_name IS NOT NULL
        """).fetchall()
    except Exception:
        artists_needing_images = []

    artist_names = [row[0] for row in artists_needing_images]

    # Filter to artists not already cached with images
    for artist_name in artist_names:
        existing = meta_conn.execute(
            "SELECT image_url FROM artist_metadata WHERE artist_name = ?",
            [artist_name],
        ).fetchone()

        if existing and existing[0]:
            continue

        # We need the artist's Spotify ID to call oEmbed. Unfortunately, the
        # history data only has artist_name, not artist URI. We can try to
        # find a track by this artist in our track_metadata and use oEmbed
        # on the artist name via a search-like approach. However, Spotify
        # oEmbed requires a Spotify URL with an ID.
        #
        # Strategy: Look up a track_id for this artist in track_metadata,
        # then use the track's oEmbed which gives album art (not artist image).
        # For actual artist images, we'd need the artist Spotify ID.
        #
        # Since we don't have artist IDs in the history data, we'll skip
        # direct artist image fetching here and rely on track album art
        # for visual display. Artist images can be added later if a source
        # for artist Spotify IDs becomes available.

        # Insert artist record without image for now
        meta_conn.execute(
            "INSERT OR IGNORE INTO artist_metadata (artist_name) VALUES (?)",
            [artist_name],
        )

    logger.info(f"Image enrichment: {stats['tracks']} track images fetched.")
    return stats


# ---------------------------------------------------------------------------
# Phase 2b: Release dates from Deezer API
# ---------------------------------------------------------------------------


def _fetch_deezer_release_date(
    track_name: str, artist_name: str
) -> str | None:
    """Search Deezer for a track and return the album release date."""
    query = f'artist:"{artist_name}" track:"{track_name}"'
    encoded_query = urllib.parse.quote(query)
    search_url = f"{DEEZER_SEARCH_URL}?q={encoded_query}&limit=1"

    try:
        req = urllib.request.Request(
            search_url,
            headers={"User-Agent": "Rewind/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())

        results = data.get("data", [])
        if not results:
            return None

        album_id = results[0].get("album", {}).get("id")
        if not album_id:
            return None

        # Fetch album details for release date
        album_url = f"{DEEZER_ALBUM_URL}/{album_id}"
        req2 = urllib.request.Request(
            album_url,
            headers={"User-Agent": "Rewind/1.0"},
        )
        with urllib.request.urlopen(req2, timeout=10) as resp2:
            album_data = json.loads(resp2.read())

        return album_data.get("release_date")

    except Exception as e:
        logger.debug(f"Deezer lookup failed for '{track_name}' by '{artist_name}': {e}")
        return None


def enrich_release_dates(
    session_conn: duckdb.DuckDBPyConnection,
    meta_conn: duckdb.DuckDBPyConnection,
) -> dict:
    """
    Phase 2b: Fetch release dates from Deezer API.
    Only fetches for tracks/albums missing release_date in the cache.

    Returns stats dict.
    """
    stats = {"tracks_updated": 0, "albums_updated": 0}

    # Get tracks missing release dates that are in this user's history
    tracks_needing_dates = meta_conn.execute("""
        SELECT track_id, track_name, artist_name
        FROM track_metadata
        WHERE release_date IS NULL
          AND track_name IS NOT NULL
          AND artist_name IS NOT NULL
    """).fetchall()

    # Also track unique albums to update album_metadata
    album_dates = {}  # (album_name, artist_name) -> release_date

    for track_id, track_name, artist_name in tracks_needing_dates:
        release_date = _fetch_deezer_release_date(track_name, artist_name)
        if release_date:
            meta_conn.execute(
                "UPDATE track_metadata SET release_date = ? WHERE track_id = ?",
                [release_date, track_id],
            )
            stats["tracks_updated"] += 1
        time.sleep(DEEZER_DELAY)

    # Update album_metadata with release dates where available
    try:
        albums = session_conn.execute("""
            SELECT DISTINCT album_name, artist_name
            FROM history
            WHERE album_name IS NOT NULL AND artist_name IS NOT NULL
        """).fetchall()

        for album_name, artist_name in albums:
            existing = meta_conn.execute(
                "SELECT release_date FROM album_metadata WHERE album_name = ? AND artist_name = ?",
                [album_name, artist_name],
            ).fetchone()

            if existing and existing[0]:
                continue

            # Try to get release_date from a track in this album
            track_date = meta_conn.execute("""
                SELECT release_date FROM track_metadata
                WHERE artist_name = ? AND release_date IS NOT NULL
                LIMIT 1
            """, [artist_name]).fetchone()

            release_date = track_date[0] if track_date else None

            meta_conn.execute("""
                INSERT OR IGNORE INTO album_metadata (album_name, artist_name, release_date)
                VALUES (?, ?, ?)
            """, [album_name, artist_name, release_date])

            if release_date:
                stats["albums_updated"] += 1

    except Exception as e:
        logger.warning(f"Album date enrichment failed: {e}")

    logger.info(
        f"Release date enrichment: {stats['tracks_updated']} tracks, "
        f"{stats['albums_updated']} albums updated."
    )
    return stats


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def enrich_all(
    session_conn: duckdb.DuckDBPyConnection,
    hf_token: str | None = None,
) -> dict:
    """
    Run the full enrichment pipeline. Called automatically after upload.

    Args:
        session_conn: DuckDB connection to the session database (history table).
        hf_token: HuggingFace read token for accessing the gated Embeat dataset.

    Returns:
        Combined stats from all enrichment phases.
    """
    meta_conn = get_metadata_conn()

    try:
        # Phase 1: Bulk audio features from Embeat (fast)
        logger.info("Phase 1: Enriching audio features from Embeat...")
        audio_stats = enrich_audio_features(session_conn, meta_conn, hf_token)
        logger.info(
            f"Phase 1 complete: {audio_stats['matched']}/{audio_stats['queried']} "
            f"tracks matched ({audio_stats['already_cached']} were cached)."
        )

        # Phase 2a: Images from Spotify oEmbed (rate-limited)
        logger.info("Phase 2a: Enriching images from Spotify oEmbed...")
        image_stats = enrich_images(session_conn, meta_conn)

        # Phase 2b: Release dates from Deezer (rate-limited)
        logger.info("Phase 2b: Enriching release dates from Deezer...")
        date_stats = enrich_release_dates(session_conn, meta_conn)

        return {
            "audio_features": audio_stats,
            "images": image_stats,
            "release_dates": date_stats,
        }
    finally:
        meta_conn.close()
