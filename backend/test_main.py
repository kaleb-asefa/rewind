import os
import duckdb
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func
import database
import load
import main
from database import table_registry
from main import app

run_enrichment_job = main._run_enrichment_job


@pytest.fixture(autouse=True)
def setup_and_teardown(tmp_path, monkeypatch):
    session_db_path = str(tmp_path / "rewind.duckdb")
    metadata_db_path = str(tmp_path / "metadata.duckdb")
    monkeypatch.setattr(database, "DB_PATH", session_db_path)
    monkeypatch.setattr(main, "DB_PATH", session_db_path)
    monkeypatch.setattr(load, "METADATA_DB_PATH", metadata_db_path)
    monkeypatch.setattr(main, "_run_enrichment_job", lambda app, job_id: None)
    table_registry.reset()
    yield
    table_registry.reset()

def test_upload_and_sqlalchemy_core_query():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        
        with open(sample_json_path, "rb") as f:
            response = client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        assert response.status_code == 200
        res_data = response.json()
        assert res_data["status"] == "ok"
        assert res_data["total_rows"] == 1480

        # Verify querying reflected table via SQLAlchemy Core engine
        engine = app.state.engine
        history = table_registry.get_history_table(engine)

        stmt = select(func.count()).select_from(history)
        with engine.connect() as conn:
            total_count = conn.execute(stmt).scalar()
            assert total_count == 1480

            # Verify querying top artist with SQLAlchemy Core
            top_artist_stmt = (
                select(history.c.artist_name, func.sum(history.c.ms_played).label("total_ms"))
                .where(history.c.artist_name.isnot(None))
                .group_by(history.c.artist_name)
                .order_by(func.sum(history.c.ms_played).desc())
                .limit(1)
            )
            top_artist_row = conn.execute(top_artist_stmt).first()
            assert top_artist_row is not None
            assert top_artist_row.artist_name is not None

def test_total_time_endpoint():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        res = client.get("/api/metrics/total-time")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "total_minutes" in data
        assert data["total_minutes"] > 0


def test_multi_file_upload():
    with TestClient(app) as client:
        f1_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        f2_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json")

        with open(f1_path, "rb") as f1, open(f2_path, "rb") as f2:
            files = [
                ("files", ("Streaming_History_Audio_2025_1.json", f1, "application/json")),
                ("files", ("Streaming_History_Audio_2022-2025_0.json", f2, "application/json")),
            ]
            response = client.post("/api/upload", files=files)

        assert response.status_code == 200
        res_data = response.json()
        assert res_data["status"] == "ok"
        assert res_data["files_processed"] == 2
        assert res_data["total_rows"] == 17648


def test_upload_queues_enrichment_and_exposes_live_ingestion_status():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            response = client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        assert response.status_code == 200
        upload_data = response.json()
        assert upload_data["enrichment"]["status"] == "queued"
        assert upload_data["enrichment"]["job_id"]

        status_response = client.get("/api/ingestion-status?limit=5")
        assert status_response.status_code == 200
        status_data = status_response.json()
        assert status_data["status"] == "ok"
        assert status_data["total_rows"] == 1480
        assert status_data["unique_tracks"] > 0
        assert len(status_data["recent_rows"]) == 5
        assert status_data["enrichment"]["job_id"] == upload_data["enrichment"]["job_id"]


def test_enrichment_process_failure_does_not_stop_api(monkeypatch):
    class FailedProcess:
        exitcode = -9

        def start(self):
            pass

        def is_alive(self):
            return False

        def join(self, timeout=None):
            pass

    class EmptyStatusQueue:
        def get_nowait(self):
            raise main.Empty

        def close(self):
            pass

    class FailedProcessContext:
        def Queue(self):
            return EmptyStatusQueue()

        def Process(self, **kwargs):
            return FailedProcess()

    monkeypatch.setattr(main, "get_context", lambda method: FailedProcessContext())

    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            response = client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        job_id = response.json()["enrichment"]["job_id"]
        run_enrichment_job(app, job_id)

        enrichment_response = client.get("/api/enrichment-status")
        assert enrichment_response.status_code == 200
        assert enrichment_response.json()["status"] == "error"
        assert "code -9" in enrichment_response.json()["job"]["error"]

        ingestion_response = client.get("/api/ingestion-status?limit=1")
        assert ingestion_response.status_code == 200
        assert ingestion_response.json()["total_rows"] == 1480


def test_top_artist_endpoint():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        res = client.get("/api/metrics/top-artist")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["artist_name"] is not None
        assert data["total_streams"] > 0
        assert data["total_minutes"] > 0


def test_top_album_endpoint():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        res = client.get("/api/metrics/top-album")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["album_name"] is not None
        assert data["artist_name"] is not None
        assert data["total_streams"] > 0
        assert data["total_minutes"] > 0


def test_top_track_endpoint():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        res = client.get("/api/metrics/top-track")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["track_name"] is not None
        assert data["artist_name"] is not None
        assert data["total_streams"] > 0
        assert data["total_minutes"] > 0


def test_artist_rank_endpoint():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        res = client.get("/api/metrics/artist-rank?limit=5")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "start_month" in data
        assert "end_month" in data
        assert data["total_months"] > 0
        assert len(data["months"]) == data["total_months"]
        assert len(data["data"]) >= 5  # includes all unique items across months
        first_item = data["data"][0]
        assert first_item["rank"] == 1
        assert "artist_name" in first_item
        assert "total_streams" in first_item
        assert "total_minutes" in first_item
        assert "monthly_ranks" in first_item
        assert len(first_item["monthly_ranks"]) == data["total_months"]


def test_track_rank_endpoint():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        res = client.get("/api/metrics/track-rank?limit=5")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "start_month" in data
        assert "end_month" in data
        assert data["total_months"] > 0
        assert len(data["months"]) == data["total_months"]
        assert len(data["data"]) >= 5  # includes all unique items across months
        first_item = data["data"][0]
        assert first_item["rank"] == 1
        assert "track_name" in first_item
        assert "artist_name" in first_item
        assert "total_streams" in first_item
        assert "total_minutes" in first_item
        assert "monthly_ranks" in first_item
        assert len(first_item["monthly_ranks"]) == data["total_months"]








