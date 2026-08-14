"""Isolated metadata worker for memory-intensive external enrichment."""

from datetime import datetime, timezone
import logging

from load import (
    enrich_audio_features,
    enrich_images,
    enrich_release_dates,
    get_metadata_conn,
)

logger = logging.getLogger(__name__)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cache_summary(meta_conn) -> dict:
    row = meta_conn.execute("""
        SELECT
            count(*) AS tracks_cached,
            count(image_url) AS tracks_with_images,
            count(release_date) AS tracks_with_release_dates,
            count(genre) AS tracks_with_genre
        FROM track_metadata
    """).fetchone()
    return {
        "tracks_cached": row[0],
        "tracks_with_images": row[1],
        "tracks_with_release_dates": row[2],
        "tracks_with_genre": row[3],
        "artists_cached": meta_conn.execute(
            "SELECT count(*) FROM artist_metadata"
        ).fetchone()[0],
        "albums_cached": meta_conn.execute(
            "SELECT count(*) FROM album_metadata"
        ).fetchone()[0],
    }


def run_metadata_enrichment(job_id, hf_token, status_queue, initial_stats) -> None:
    """Run external enrichment in a process isolated from the FastAPI server."""
    stats = dict(initial_stats)
    meta_conn = None
    try:
        meta_conn = get_metadata_conn()

        def report_audio_progress(audio_stats, feature_samples):
            status_queue.put({
                "job_id": job_id,
                "status": "processing",
                "phase": "audio_features",
                "stats": {**stats, "audio_features": audio_stats},
                "feature_samples": feature_samples,
            })

        stats["audio_features"] = enrich_audio_features(
            meta_conn,
            hf_token,
            progress_callback=report_audio_progress,
        )
        status_queue.put({
            "job_id": job_id,
            "status": "processing",
            "phase": "images",
            "stats": dict(stats),
        })

        stats["images"] = enrich_images(meta_conn)
        status_queue.put({
            "job_id": job_id,
            "status": "processing",
            "phase": "release_dates",
            "stats": dict(stats),
        })

        stats["release_dates"] = enrich_release_dates(meta_conn)
        status_queue.put({
            "job_id": job_id,
            "status": "complete",
            "phase": "complete",
            "stats": stats,
            "cache": _cache_summary(meta_conn),
            "completed_at": _utc_now(),
        })
    except Exception as exc:
        logger.exception("Metadata enrichment job %s failed", job_id)
        status_queue.put({
            "job_id": job_id,
            "status": "error",
            "phase": "error",
            "error": str(exc),
            "stats": stats,
            "completed_at": _utc_now(),
        })
    finally:
        if meta_conn is not None:
            meta_conn.close()