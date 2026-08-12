"""
Song metadata enrichment pipeline for Rewind.

Two-phase auto-enrichment after upload:
  Phase 0: Seed metadata cache from session history.
  Phase 1 (fast): Bulk audio features + genre from Embeat 45M HuggingFace dataset
                   via DuckDB httpfs — no download, remote Parquet queries.
  Phase 2a (rate-limited): Track & Album cover art via Spotify oEmbed API,
                            Artist photos via Deezer Artist API.
  Phase 2b (rate-limited): Album release dates via Deezer API.

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

# Embeat parquet files on HuggingFace (gated — requires HF token starting with hf_)
EMBEAT_PARQUET_URLS = [
    "https://huggingface.co/api/datasets/GD-Studio/embeat_45m_spotify_tracks/parquet/default/train/0.parquet",
    "https://huggingface.co/api/datasets/GD-Studio/embeat_45m_spotify_tracks/parquet/default/train/1.parquet",
    "https://huggingface.co/api/datasets/GD-Studio/embeat_45m_spotify_tracks/parquet/default/train/2.parquet",
]

SPOTIFY_OEMBED_URL = "https://open.spotify.com/oembed"
DEEZER_SEARCH_TRACK_URL = "https://api.deezer.com/search/track"
DEEZER_SEARCH_ARTIST_URL = "https://api.deezer.com/search/artist"
DEEZER_ALBUM_URL = "https://api.deezer.com/album"

# Rate limits
OEMBED_DELAY = 0.1  # 10 req/sec
DEEZER_DELAY = 0.1  # 10 req/sec (official: 50/5s)

# Batch size for DuckDB IN clause
BATCH_SIZE = 500


# ---------------------------------------------------------------------------
# Metadata DB setup & Seeding
# ---------------------------------------------------------------------------


def get_metadata_conn(read_only: bool = False) -> duckdb.DuckDBPyConnection:
    """Get or create the shared persistent metadata database connection."""
    os.makedirs(os.path.dirname(METADATA_DB_PATH), exist_ok=True)
    try:
        conn = duckdb.connect(METADATA_DB_PATH, read_only=read_only)
    except duckdb.Error:
        # Fallback to read-only mode if locked by an external process like duckdb -ui
        conn = duckdb.connect(METADATA_DB_PATH, read_only=True)

    try:
        _ensure_metadata_tables(conn)
    except duckdb.Error:
        pass  # Read-only connections cannot create tables if missing
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


def seed_metadata_cache(
    session_conn: duckdb.DuckDBPyConnection,
    meta_conn: duckdb.DuckDBPyConnection,
) -> dict:
    """
    Phase 0: Seed track_metadata, artist_metadata, and album_metadata with entries
    from session history so that all tracks/artists/albums are registered even if
    external API calls fail or are skipped.
    """
    stats = {"tracks_seeded": 0, "artists_seeded": 0, "albums_seeded": 0}

    # 1. Seed tracks
    try:
        tracks = session_conn.execute("""
            SELECT DISTINCT
                REPLACE(track_uri, 'spotify:track:', '') AS track_id,
                track_name,
                artist_name
            FROM history
            WHERE track_uri LIKE 'spotify:track:%'
              AND track_name IS NOT NULL
        """).fetchall()

        for track_id, track_name, artist_name in tracks:
            res = meta_conn.execute("""
                INSERT INTO track_metadata (track_id, track_name, artist_name)
                VALUES (?, ?, ?)
                ON CONFLICT (track_id) DO UPDATE SET
                    track_name = COALESCE(track_metadata.track_name, EXCLUDED.track_name),
                    artist_name = COALESCE(track_metadata.artist_name, EXCLUDED.artist_name)
            """, [track_id, track_name, artist_name])
            stats["tracks_seeded"] += 1
    except Exception as e:
        logger.error(f"Error seeding track_metadata: {e}")

    # 2. Seed artists
    try:
        artists = session_conn.execute("""
            SELECT DISTINCT artist_name
            FROM history
            WHERE artist_name IS NOT NULL
        """).fetchall()

        for (artist_name,) in artists:
            meta_conn.execute("""
                INSERT INTO artist_metadata (artist_name)
                VALUES (?)
                ON CONFLICT (artist_name) DO NOTHING
            """, [artist_name])
            stats["artists_seeded"] += 1
    except Exception as e:
        logger.error(f"Error seeding artist_metadata: {e}")

    # 3. Seed albums
    try:
        albums = session_conn.execute("""
            SELECT DISTINCT album_name, artist_name
            FROM history
            WHERE album_name IS NOT NULL AND artist_name IS NOT NULL
        """).fetchall()

        for album_name, artist_name in albums:
            meta_conn.execute("""
                INSERT INTO album_metadata (album_name, artist_name)
                VALUES (?, ?)
                ON CONFLICT (album_name, artist_name) DO NOTHING
            """, [album_name, artist_name])
            stats["albums_seeded"] += 1
    except Exception as e:
        logger.error(f"Error seeding album_metadata: {e}")

    return stats


# ---------------------------------------------------------------------------
# Phase 1: Bulk audio features from Embeat via DuckDB httpfs
# ---------------------------------------------------------------------------


def _load_genre_map(hf_token: str | None = None) -> dict[int, str]:
    """Load or download the artist_genre_map.json from Embeat."""
    if os.path.exists(GENRE_MAP_PATH):
        try:
            with open(GENRE_MAP_PATH) as f:
                raw = json.load(f)
            return {int(k): v for k, v in raw.items()}
        except Exception:
            pass

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
        logger.warning(f"Failed to download genre map: {e}")
        return {}


def enrich_audio_features(
    session_conn: duckdb.DuckDBPyConnection,
    meta_conn: duckdb.DuckDBPyConnection,
    hf_token: str | None = None,
) -> dict:
    """
    Phase 1: Query Embeat dataset via httpfs for audio features, duration, genre.
    Only queries tracks missing audio features (danceability IS NULL).

    Returns stats dict.
    """
    # Find track IDs in cache that lack audio features
    missing_rows = meta_conn.execute(
        "SELECT track_id FROM track_metadata WHERE danceability IS NULL"
    ).fetchall()
    missing_ids = [r[0] for r in missing_rows]

    total_cached = meta_conn.execute(
        "SELECT count(*) FROM track_metadata WHERE danceability IS NOT NULL"
    ).fetchone()[0]

    stats = {
        "total_tracks": len(missing_ids) + total_cached,
        "already_cached": total_cached,
        "queried": len(missing_ids),
        "matched": 0,
    }

    if not missing_ids:
        logger.info("All tracks already have audio features in cache.")
        return stats

    if not hf_token:
        logger.warning("No HF_TOKEN provided — skipping Embeat audio features.")
        return stats

    if not hf_token.startswith("hf_"):
        logger.warning(
            f"HF_TOKEN '{hf_token[:6]}...' does not start with 'hf_'. "
            "HuggingFace access tokens must start with 'hf_' (generate at https://huggingface.co/settings/tokens). "
            "Skipping Embeat audio features."
        )
        return stats

    genre_map = _load_genre_map(hf_token)

    # Resolve HuggingFace API URLs to signed CloudFront CDN URLs in Python.
    # Python's urllib automatically handles the 302 redirect and strips the
    # Authorization header when redirected to AWS CloudFront, avoiding the
    # HTTP 400 / HTTP 0 error that DuckDB's httpfs experiences when forwarding headers.
    resolved_sources = []
    for url in EMBEAT_PARQUET_URLS:
        try:
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {hf_token}"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                resolved_sources.append(resp.geturl())
        except Exception as e:
            logger.warning(f"Failed to resolve HuggingFace parquet URL '{url}': {e}")

    if not resolved_sources:
        logger.warning("Could not resolve HuggingFace parquet CDN URLs. Skipping Embeat query.")
        return stats

    try:
        meta_conn.execute("INSTALL httpfs; LOAD httpfs;")
        meta_conn.execute("SET allow_asterisks_in_http_paths = true;")
    except Exception as e:
        logger.warning(f"Failed to configure DuckDB httpfs: {e}")
        return stats

    parquet_sources = ", ".join(f"'{url}'" for url in resolved_sources)
    total_matched = 0

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
            logger.warning(
                f"Embeat batch {i // BATCH_SIZE} query failed: {e}. "
                "Ensure your HuggingFace account has accepted terms at "
                "https://huggingface.co/datasets/GD-Studio/embeat_45m_spotify_tracks"
            )
            continue

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
                UPDATE track_metadata SET
                    popularity = COALESCE(popularity, ?),
                    duration_ms = COALESCE(duration_ms, ?),
                    danceability = ?,
                    energy = ?,
                    valence = ?,
                    tempo = ?,
                    key = ?,
                    mode = ?,
                    acousticness = ?,
                    instrumentalness = ?,
                    liveness = ?,
                    loudness = ?,
                    speechiness = ?,
                    time_signature = ?,
                    genre = COALESCE(genre, ?)
                WHERE track_id = ?
            """, [
                popularity, duration_ms,
                danceability, energy, valence, tempo,
                key, mode, acousticness, instrumentalness,
                liveness, loudness, speechiness, time_signature,
                genre, track_id
            ])
            total_matched += 1

        logger.info(
            f"Embeat batch {i // BATCH_SIZE + 1}: "
            f"queried {len(batch)}, matched {len(rows)}"
        )

    stats["matched"] = total_matched
    return stats


# ---------------------------------------------------------------------------
# Phase 2a: Images (Spotify oEmbed for Tracks/Albums & Deezer for Artists)
# ---------------------------------------------------------------------------


def _fetch_spotify_oembed_image(spotify_type: str, spotify_id: str) -> str | None:
    """Fetch thumbnail image URL from Spotify oEmbed API."""
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
        logger.debug(f"Spotify oEmbed failed for {spotify_type}/{spotify_id}: {e}")
        return None


def _fetch_deezer_artist_image(artist_name: str) -> str | None:
    """Fetch artist photo URL from Deezer Search Artist API."""
    query = urllib.parse.quote(artist_name)
    url = f"{DEEZER_SEARCH_ARTIST_URL}?q={query}&limit=1"

    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Rewind/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())

        results = data.get("data", [])
        if results:
            artist = results[0]
            return artist.get("picture_medium") or artist.get("picture_big")
    except Exception as e:
        logger.debug(f"Deezer artist search failed for '{artist_name}': {e}")

    return None


def enrich_images(
    session_conn: duckdb.DuckDBPyConnection,
    meta_conn: duckdb.DuckDBPyConnection,
) -> dict:
    """
    Phase 2a: Fetch track/album cover images via Spotify oEmbed,
    and artist photos via Deezer Artist Search API.

    Returns stats dict.
    """
    stats = {"tracks": 0, "artists": 0, "albums": 0}

    # 1. Track images (album cover art)
    tracks_needing_images = meta_conn.execute(
        "SELECT track_id, artist_name FROM track_metadata WHERE image_url IS NULL"
    ).fetchall()

    for track_id, artist_name in tracks_needing_images:
        image_url = _fetch_spotify_oembed_image("track", track_id)
        if image_url:
            meta_conn.execute(
                "UPDATE track_metadata SET image_url = ? WHERE track_id = ?",
                [image_url, track_id],
            )
            stats["tracks"] += 1

            # Update album_metadata for albums by this artist missing an image
            if artist_name:
                meta_conn.execute("""
                    UPDATE album_metadata SET image_url = ?
                    WHERE artist_name = ? AND image_url IS NULL
                """, [image_url, artist_name])
                stats["albums"] += 1

        time.sleep(OEMBED_DELAY)

    # 2. Artist images (artist photos)
    artists_needing_images = meta_conn.execute(
        "SELECT artist_name FROM artist_metadata WHERE image_url IS NULL"
    ).fetchall()

    for (artist_name,) in artists_needing_images:
        image_url = _fetch_deezer_artist_image(artist_name)
        if image_url:
            meta_conn.execute(
                "UPDATE artist_metadata SET image_url = ? WHERE artist_name = ?",
                [image_url, artist_name],
            )
            stats["artists"] += 1
        time.sleep(DEEZER_DELAY)

    logger.info(
        f"Image enrichment complete: {stats['tracks']} track covers, "
        f"{stats['artists']} artist photos, {stats['albums']} album covers."
    )
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
    search_url = f"{DEEZER_SEARCH_TRACK_URL}?q={encoded_query}&limit=1"

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

        album_url = f"{DEEZER_ALBUM_URL}/{album_id}"
        req2 = urllib.request.Request(
            album_url,
            headers={"User-Agent": "Rewind/1.0"},
        )
        with urllib.request.urlopen(req2, timeout=10) as resp2:
            album_data = json.loads(resp2.read())

        return album_data.get("release_date")

    except Exception as e:
        logger.debug(f"Deezer release date lookup failed for '{track_name}' by '{artist_name}': {e}")
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

    tracks_needing_dates = meta_conn.execute("""
        SELECT track_id, track_name, artist_name
        FROM track_metadata
        WHERE release_date IS NULL
          AND track_name IS NOT NULL
          AND artist_name IS NOT NULL
    """).fetchall()

    for track_id, track_name, artist_name in tracks_needing_dates:
        release_date = _fetch_deezer_release_date(track_name, artist_name)
        if release_date:
            meta_conn.execute(
                "UPDATE track_metadata SET release_date = ? WHERE track_id = ?",
                [release_date, track_id],
            )
            stats["tracks_updated"] += 1

            # Update album_metadata for this artist
            meta_conn.execute("""
                UPDATE album_metadata SET release_date = ?
                WHERE artist_name = ? AND release_date IS NULL
            """, [release_date, artist_name])
            stats["albums_updated"] += 1

        time.sleep(DEEZER_DELAY)

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
        # Phase 0: Seed metadata tables from session history
        logger.info("Phase 0: Seeding metadata cache from history...")
        seed_stats = seed_metadata_cache(session_conn, meta_conn)
        logger.info(f"Phase 0 complete: {seed_stats}")

        # Phase 1: Bulk audio features from Embeat (fast)
        logger.info("Phase 1: Enriching audio features from Embeat...")
        audio_stats = enrich_audio_features(session_conn, meta_conn, hf_token)

        # Phase 2a: Images from Spotify oEmbed & Deezer Artist API
        logger.info("Phase 2a: Enriching images...")
        image_stats = enrich_images(session_conn, meta_conn)

        # Phase 2b: Release dates from Deezer
        logger.info("Phase 2b: Enriching release dates...")
        date_stats = enrich_release_dates(session_conn, meta_conn)

        return {
            "seeded": seed_stats,
            "audio_features": audio_stats,
            "images": image_stats,
            "release_dates": date_stats,
        }
    finally:
        meta_conn.close()
