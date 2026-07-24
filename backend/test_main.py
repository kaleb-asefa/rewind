import os
import duckdb
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from database import table_registry
from main import app, DB_PATH

@pytest.fixture(autouse=True)
def setup_and_teardown():
    table_registry.reset()
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    yield
    table_registry.reset()
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)

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

        # Test minutes (default)
        res_min = client.get("/api/metrics/total-time?unit=minutes")
        assert res_min.status_code == 200
        data_min = res_min.json()
        assert data_min["unit"] == "minutes"
        assert data_min["label"] == "Minutes"
        assert data_min["value"] > 0

        # Test hours
        res_hr = client.get("/api/metrics/total-time?unit=hours")
        assert res_hr.status_code == 200
        data_hr = res_hr.json()
        assert data_hr["unit"] == "hours"
        assert data_hr["label"] == "Hours"
        assert data_hr["value"] < data_min["value"]

        # Test days
        res_day = client.get("/api/metrics/total-time?unit=days")
        assert res_day.status_code == 200
        data_day = res_day.json()
        assert data_day["unit"] == "days"
        assert data_day["label"] == "Days"
        assert data_day["value"] < data_hr["value"]

