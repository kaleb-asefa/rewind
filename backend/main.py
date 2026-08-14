from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
from multiprocessing import get_context
import os
from queue import Empty, Queue
import shutil
import tempfile
from threading import Event, Lock, Thread
from uuid import uuid4

import duckdb
from config import settings
from database import DB_PATH, get_db, lifespan as database_lifespan, table_registry
from enrichment_worker import run_metadata_enrichment
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from load import get_metadata_conn, seed_metadata_cache
from sqlalchemy import func, select
from sqlalchemy.engine import Connection
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with database_lifespan(app):
        app.state.enrichment_jobs = {}
        app.state.latest_enrichment_job_id = None
        app.state.enrichment_lock = Lock()
        app.state.enrichment_queue = Queue()
        app.state.enrichment_stop = Event()
        app.state.enrichment_process = None
        worker = Thread(
            target=_enrichment_worker_loop,
            args=(app,),
            name="rewind-enrichment",
            daemon=True,
        )
        worker.start()
        _queue_existing_session(app)
        try:
            yield
        finally:
            app.state.enrichment_stop.set()
            app.state.enrichment_queue.put(None)
            worker.join(timeout=5)
            process = app.state.enrichment_process
            if process and process.is_alive():
                process.terminate()
                process.join(timeout=2)


app = FastAPI(title="Rewind API", lifespan=lifespan)

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


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _update_enrichment_job(app: FastAPI, job_id: str, **updates) -> None:
    with app.state.enrichment_lock:
        job = app.state.enrichment_jobs[job_id]
        job.update(updates)
        job["updated_at"] = _utc_now()


def _latest_enrichment_job(app: FastAPI) -> dict | None:
    with app.state.enrichment_lock:
        job_id = app.state.latest_enrichment_job_id
        if not job_id:
            return None
        return dict(app.state.enrichment_jobs[job_id])


def _queue_enrichment_job(
    app: FastAPI,
    *,
    files_processed: int,
    total_rows: int,
    source: str,
) -> str:
    job_id = str(uuid4())
    now = _utc_now()
    job = {
        "job_id": job_id,
        "status": "queued",
        "phase": "queued",
        "source": source,
        "files_processed": files_processed,
        "total_rows": total_rows,
        "created_at": now,
        "updated_at": now,
        "stats": {},
    }
    with app.state.enrichment_lock:
        app.state.enrichment_jobs[job_id] = job
        app.state.latest_enrichment_job_id = job_id
    app.state.enrichment_queue.put(job_id)
    return job_id


def _queue_existing_session(app: FastAPI) -> None:
    try:
        with app.state.engine.connect() as connection:
            table_exists = connection.exec_driver_sql("""
                SELECT count(*)
                FROM information_schema.tables
                WHERE table_name = 'history'
            """).scalar()
            if not table_exists:
                return
            total_rows = connection.exec_driver_sql(
                "SELECT count(*) FROM history"
            ).scalar()
    except Exception:
        logger.exception("Could not inspect the existing session for enrichment")
        return

    if total_rows:
        _queue_enrichment_job(
            app,
            files_processed=0,
            total_rows=total_rows,
            source="startup_recovery",
        )


def _apply_enrichment_message(app: FastAPI, job_id: str, message: dict) -> None:
    message.pop("job_id", None)
    _update_enrichment_job(app, job_id, **message)


def _run_enrichment_job(app: FastAPI, job_id: str) -> None:
    stats = {}
    try:
        _update_enrichment_job(
            app,
            job_id,
            status="processing",
            phase="seeding_cache",
            started_at=_utc_now(),
        )

        with app.state.engine.connect() as connection:
            session_conn = connection.connection.driver_connection
            meta_conn = get_metadata_conn()
            try:
                stats["seeded"] = seed_metadata_cache(session_conn, meta_conn)
            finally:
                meta_conn.close()

        if app.state.enrichment_stop.is_set():
            return

        _update_enrichment_job(
            app,
            job_id,
            phase="audio_features",
            stats=dict(stats),
        )

        context = get_context("spawn")
        status_queue = context.Queue()
        process = context.Process(
            target=run_metadata_enrichment,
            args=(job_id, settings.hf_token, status_queue, stats),
            name=f"rewind-enrichment-{job_id[:8]}",
            daemon=True,
        )
        app.state.enrichment_process = process
        process.start()

        final_message_received = False
        while process.is_alive():
            if app.state.enrichment_stop.is_set():
                process.terminate()
                break
            try:
                message = status_queue.get(timeout=0.5)
            except Empty:
                continue
            _apply_enrichment_message(app, job_id, message)
            final_message_received = message.get("status") in {"complete", "error"}

        process.join(timeout=2)
        while True:
            try:
                message = status_queue.get_nowait()
            except Empty:
                break
            _apply_enrichment_message(app, job_id, message)
            final_message_received = message.get("status") in {"complete", "error"}

        status_queue.close()
        app.state.enrichment_process = None

        if app.state.enrichment_stop.is_set():
            _update_enrichment_job(
                app,
                job_id,
                status="cancelled",
                phase="cancelled",
                completed_at=_utc_now(),
            )
        elif process.exitcode != 0 and not final_message_received:
            _update_enrichment_job(
                app,
                job_id,
                status="error",
                phase="error",
                error=f"Metadata worker exited unexpectedly with code {process.exitcode}.",
                completed_at=_utc_now(),
            )
    except Exception as exc:
        logger.exception("Metadata enrichment job %s failed", job_id)
        _update_enrichment_job(
            app,
            job_id,
            status="error",
            phase="error",
            error=str(exc),
            stats=stats,
            completed_at=_utc_now(),
        )
    finally:
        app.state.enrichment_process = None


def _enrichment_worker_loop(app: FastAPI) -> None:
    while not app.state.enrichment_stop.is_set():
        job_id = app.state.enrichment_queue.get()
        try:
            if job_id is None:
                return
            _run_enrichment_job(app, job_id)
        finally:
            app.state.enrichment_queue.task_done()


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


@app.post("/api/upload")
async def upload(
    request: Request,
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

    job_id = _queue_enrichment_job(
        request.app,
        files_processed=result["files_processed"],
        total_rows=result["total_rows"],
        source="upload",
    )

    result["enrichment"] = {
        "status": "queued",
        "job_id": job_id,
    }

    return result


@app.get("/api/enrichment-status")
async def get_enrichment_status(request: Request):
    """Return the latest in-process enrichment state without locking the cache."""
    job = _latest_enrichment_job(request.app)
    if not job:
        return {"status": "idle", "job": None}

    return {
        "status": job["status"],
        **job.get("cache", {}),
        "job": job,
    }


@app.get("/api/ingestion-status")
async def get_ingestion_status(
    request: Request,
    limit: int = Query(default=5, ge=1, le=20),
    conn: Connection = Depends(get_db),
):
    """Return live history-table totals and the latest ingested rows."""
    def query():
        try:
            history = table_registry.get_history_table(request.app.state.engine)
        except HTTPException as exc:
            if exc.status_code == 400:
                return {
                    "status": "empty",
                    "total_rows": 0,
                    "unique_tracks": 0,
                    "first_stream": None,
                    "latest_stream": None,
                    "recent_rows": [],
                }
            raise

        summary = conn.execute(
            select(
                func.count().label("total_rows"),
                func.count(func.distinct(history.c.track_uri)).label(
                    "unique_tracks"
                ),
                func.min(history.c.ts).label("first_stream"),
                func.max(history.c.ts).label("latest_stream"),
            )
        ).mappings().one()

        rows = conn.execute(
            select(
                history.c.ts,
                history.c.track_name,
                history.c.artist_name,
                history.c.ms_played,
            )
            .where(history.c.track_name.isnot(None))
            .order_by(history.c.ts.desc().nulls_last())
            .limit(limit)
        ).mappings().all()

        def serialize_timestamp(value):
            return value.isoformat() if value else None

        return {
            "status": "ok",
            "total_rows": summary["total_rows"],
            "unique_tracks": summary["unique_tracks"],
            "first_stream": serialize_timestamp(summary["first_stream"]),
            "latest_stream": serialize_timestamp(summary["latest_stream"]),
            "recent_rows": [
                {
                    "ts": serialize_timestamp(row["ts"]),
                    "track_name": row["track_name"],
                    "artist_name": row["artist_name"],
                    "ms_played": row["ms_played"],
                }
                for row in rows
            ],
        }

    result = await run_in_threadpool(query)
    result["enrichment"] = _latest_enrichment_job(request.app)
    return result


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
        return conn.execute(stmt).first()

    row = await run_in_threadpool(query)

    if not row:
        return {
            "status": "ok",
            "artist_name": None,
            "total_streams": 0,
            "total_minutes": 0,
        }

    return {
        "status": "ok",
        "artist_name": row.artist_name,
        "total_streams": row.total_streams,
        "total_minutes": round(row.total_ms / (1000 * 60), 2),
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
            .order_by(func.count().desc())
            .limit(1)
        )
        return conn.execute(stmt).first()

    row = await run_in_threadpool(query)

    if not row:
        return {
            "status": "ok",
            "album_name": None,
            "artist_name": None,
            "total_streams": 0,
            "total_minutes": 0,
        }

    return {
        "status": "ok",
        "album_name": row.album_name,
        "artist_name": row.artist_name,
        "total_streams": row.total_streams,
        "total_minutes": round(row.total_ms / (1000 * 60), 2),
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
        return conn.execute(stmt).first()

    row = await run_in_threadpool(query)

    if not row:
        return {
            "status": "ok",
            "track_name": None,
            "artist_name": None,
            "total_streams": 0,
            "total_minutes": 0,
        }

    return {
        "status": "ok",
        "track_name": row.track_name,
        "artist_name": row.artist_name,
        "total_streams": row.total_streams,
        "total_minutes": round(row.total_ms / (1000 * 60), 2),
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
                    date_trunc('month', ts) as month,
                    artist_name,
                    SUM(ms_played) as ms,
                    COUNT(*) as streams
                FROM history
                WHERE artist_name IS NOT NULL AND ts IS NOT NULL
                GROUP BY date_trunc('month', ts), artist_name
                ORDER BY month ASC, ms DESC, streams DESC
            """).fetchall()
        except Exception:
            monthly_data = []

        if not monthly_data:
            history = table_registry.get_history_table(request.app.state.engine)
            stmt = (
                select(
                    history.c.artist_name,
                    func.count().label("total_streams"),
                    func.coalesce(func.sum(history.c.ms_played), 0).label("total_ms"),
                )
                .where(history.c.artist_name.isnot(None))
                .group_by(history.c.artist_name)
                .order_by(func.coalesce(func.sum(history.c.ms_played), 0).desc(), func.count().desc())
                .limit(limit)
            )
            rows = conn.execute(stmt).fetchall()
            return {
                "start_month": None,
                "end_month": None,
                "total_months": 0,
                "months": [],
                "data": [
                    {
                        "rank": idx,
                        "artist_name": row.artist_name,
                        "total_streams": row.total_streams,
                        "total_minutes": round(row.total_ms / 60000, 2),
                        "monthly_ranks": [],
                    }
                    for idx, row in enumerate(rows, start=1)
                ],
            }

        # Group raw data by month
        month_groups = {}
        for month, artist, ms, streams in monthly_data:
            m_key = str(month)[:7]
            if m_key not in month_groups:
                month_groups[m_key] = []
            month_groups[m_key].append((artist, ms, streams))

        sorted_months = sorted(month_groups.keys())
        start_month = sorted_months[0]
        end_month = sorted_months[-1]
        full_months = _generate_month_sequence(start_month, end_month)

        # Step 1: For each month, compute the TRUE top `limit` artists from
        # ALL artists (not a fixed set). New artists can enter the chart.
        # Months with no data carry forward the previous month's top list.
        month_top_lists = {}  # m_key -> [(artist, ms, streams), ...]
        prev_top = []

        for m_key in full_months:
            if m_key in month_groups:
                # Month has data — use actual top N sorted by ms DESC
                month_top_lists[m_key] = month_groups[m_key][:limit]
                prev_top = month_top_lists[m_key]
            else:
                # No data — carry forward previous month unchanged
                month_top_lists[m_key] = list(prev_top)

        # Step 2: Collect every unique artist that ever appeared in a monthly
        # top list. Order them by overall lifetime ms_played for the response.
        appearance_count = {}
        for m_key in full_months:
            for artist, ms, streams in month_top_lists[m_key]:
                appearance_count[artist] = appearance_count.get(artist, 0) + 1

        all_candidates = list(appearance_count.keys())

        # Get overall stats for all candidates
        history = table_registry.get_history_table(request.app.state.engine)
        overall_stats = {}
        if all_candidates:
            stmt = (
                select(
                    history.c.artist_name,
                    func.count().label("total_streams"),
                    func.coalesce(func.sum(history.c.ms_played), 0).label("total_ms"),
                )
                .where(history.c.artist_name.in_(all_candidates))
                .group_by(history.c.artist_name)
            )
            for r in conn.execute(stmt).fetchall():
                overall_stats[r.artist_name] = (r.total_streams, r.total_ms)

        # Order by overall lifetime ms DESC — include ALL candidates
        all_featured = sorted(
            all_candidates,
            key=lambda a: overall_stats.get(a, (0, 0))[1],
            reverse=True,
        )

        # Step 3: For each featured artist, compute monthly_ranks.
        # Rank = position in that month's top list (1-N), or off-chart (limit+1).
        off_chart = limit + 1
        result_data = []
        for idx, artist_name in enumerate(all_featured, start=1):
            monthly_ranks = []
            for m_key in full_months:
                top_names = [a for a, ms, s in month_top_lists[m_key]]
                if artist_name in top_names:
                    monthly_ranks.append(top_names.index(artist_name) + 1)
                else:
                    monthly_ranks.append(off_chart)

            streams, total_ms = overall_stats.get(artist_name, (0, 0))
            result_data.append({
                "rank": idx,
                "artist_name": artist_name,
                "total_streams": streams,
                "total_minutes": round(total_ms / 60000, 2),
                "monthly_ranks": monthly_ranks,
            })

        return {
            "start_month": start_month,
            "end_month": end_month,
            "total_months": len(full_months),
            "months": full_months,
            "data": result_data,
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
                    date_trunc('month', ts) as month,
                    track_name,
                    artist_name,
                    SUM(ms_played) as ms,
                    COUNT(*) as streams
                FROM history
                WHERE track_name IS NOT NULL AND ts IS NOT NULL
                GROUP BY date_trunc('month', ts), track_name, artist_name
                ORDER BY month ASC, ms DESC, streams DESC
            """).fetchall()
        except Exception:
            monthly_data = []

        if not monthly_data:
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
                .order_by(func.coalesce(func.sum(history.c.ms_played), 0).desc(), func.count().desc())
                .limit(limit)
            )
            rows = conn.execute(stmt).fetchall()
            return {
                "start_month": None,
                "end_month": None,
                "total_months": 0,
                "months": [],
                "data": [
                    {
                        "rank": idx,
                        "track_name": row.track_name,
                        "artist_name": row.artist_name,
                        "total_streams": row.total_streams,
                        "total_minutes": round(row.total_ms / 60000, 2),
                        "monthly_ranks": [],
                    }
                    for idx, row in enumerate(rows, start=1)
                ],
            }

        month_groups = {}
        for month, track, artist, ms, streams in monthly_data:
            m_key = str(month)[:7]
            if m_key not in month_groups:
                month_groups[m_key] = []
            month_groups[m_key].append(((track, artist), ms, streams))

        sorted_months = sorted(month_groups.keys())
        start_month = sorted_months[0]
        end_month = sorted_months[-1]
        full_months = _generate_month_sequence(start_month, end_month)

        # Step 1: For each month, compute the TRUE top `limit` tracks from
        # ALL tracks (not a fixed set). New tracks can enter the chart.
        # Months with no data carry forward the previous month's top list.
        month_top_lists = {}  # m_key -> [((track,artist), ms, streams), ...]
        prev_top = []

        for m_key in full_months:
            if m_key in month_groups:
                month_top_lists[m_key] = month_groups[m_key][:limit]
                prev_top = month_top_lists[m_key]
            else:
                month_top_lists[m_key] = list(prev_top)

        # Step 2: Collect every unique track that ever appeared in a monthly
        # top list. Order them by overall lifetime ms_played for the response.
        appearance_count = {}
        for m_key in full_months:
            for pair, ms, streams in month_top_lists[m_key]:
                appearance_count[pair] = appearance_count.get(pair, 0) + 1

        all_candidates = list(appearance_count.keys())

        # Get overall stats for all candidates
        history = table_registry.get_history_table(request.app.state.engine)
        overall_stats = {}
        for track_name, artist_name in all_candidates:
            stmt = (
                select(
                    func.count().label("total_streams"),
                    func.coalesce(func.sum(history.c.ms_played), 0).label("total_ms"),
                )
                .where(history.c.track_name == track_name)
                .where(history.c.artist_name == artist_name)
            )
            r = conn.execute(stmt).first()
            if r:
                overall_stats[(track_name, artist_name)] = (r.total_streams, r.total_ms)

        # Order by overall lifetime ms DESC — include ALL candidates
        all_featured = sorted(
            all_candidates,
            key=lambda p: overall_stats.get(p, (0, 0))[1],
            reverse=True,
        )

        # Step 3: For each featured track, compute monthly_ranks.
        # Rank = position in that month's top list (1-N), or off-chart (limit+1).
        off_chart = limit + 1
        result_data = []
        for idx, (track_name, artist_name) in enumerate(all_featured, start=1):
            pair = (track_name, artist_name)
            monthly_ranks = []
            for m_key in full_months:
                top_pairs = [p for p, ms, s in month_top_lists[m_key]]
                if pair in top_pairs:
                    monthly_ranks.append(top_pairs.index(pair) + 1)
                else:
                    monthly_ranks.append(off_chart)

            streams, total_ms = overall_stats.get(pair, (0, 0))
            result_data.append({
                "rank": idx,
                "track_name": track_name,
                "artist_name": artist_name,
                "total_streams": streams,
                "total_minutes": round(total_ms / 60000, 2),
                "monthly_ranks": monthly_ranks,
            })

        return {
            "start_month": start_month,
            "end_month": end_month,
            "total_months": len(full_months),
            "months": full_months,
            "data": result_data,
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