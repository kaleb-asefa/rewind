import os
import shutil
import tempfile

import duckdb
from database import DB_PATH, get_db, lifespan, table_registry
from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.engine import Connection

app = FastAPI(title="Rewind API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAPPING = [
    ("ts", "ts"),
    ("username", "username"),
    ("platform", "platform"),
    ("ms_played", "ms_played"),
    ("conn_country", "conn_country"),
    ("master_metadata_track_name", "track_name"),
    ("master_metadata_album_artist_name", "artist_name"),
    ("master_metadata_album_album_name", "album_name"),
    ("spotify_track_uri", "track_uri"),
    ("episode_name", "episode_name"),
    ("episode_show_name", "episode_show_name"),
    ("spotify_episode_uri", "episode_uri"),
    ("reason_start", "reason_start"),
    ("reason_end", "reason_end"),
    ("shuffle", "shuffle"),
    ("skipped", "skipped"),
    ("offline", "offline"),
    ("offline_timestamp", "offline_timestamp"),
    ("incognito_mode", "incognito_mode"),
]


@app.post("/api/upload")
async def upload(file: UploadFile):
    if not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Only JSON files are supported.")

    # Save uploaded file to a temporary file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".json") as temp_file:
        shutil.copyfileobj(file.file, temp_file)
        temp_path = temp_file.name

    try:
        con = duckdb.connect(DB_PATH)

        # Inspect columns available in uploaded JSON
        describe_res = con.execute(
            "DESCRIBE SELECT * FROM read_json_auto(?, union_by_name=True)", [temp_path]
        ).fetchall()
        existing_cols = {row[0] for row in describe_res}

        select_exprs = []
        for src_col, target_col in MAPPING:
            if src_col in existing_cols:
                select_exprs.append(f"{src_col} AS {target_col}")
            else:
                select_exprs.append(f"NULL AS {target_col}")

        select_clause = ",\n            ".join(select_exprs)

        table_exists = (
            con.execute(
                "SELECT count(*) FROM information_schema.tables WHERE table_name = 'history'"
            ).fetchone()[0]
            > 0
        )

        if not table_exists:
            query = f"""
            CREATE TABLE history AS
            SELECT
                {select_clause}
            FROM read_json_auto(?, union_by_name=True)
            """
        else:
            query = f"""
            INSERT INTO history
            SELECT
                {select_clause}
            FROM read_json_auto(?, union_by_name=True)
            """

        con.execute(query, [temp_path])

        rows_added = con.execute("SELECT count(*) FROM history").fetchone()[0]

        con.close()

        # Reset table registry cache so SQLAlchemy Core picks up updated schema
        table_registry.reset()

        return {
            "status": "ok",
            "message": "File uploaded and loaded into DuckDB successfully.",
            "filename": file.filename,
            "total_rows": rows_added,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to ingest JSON into DuckDB: {str(e)}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)