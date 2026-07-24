import os
import duckdb
import pytest
from fastapi.testclient import TestClient
from main import app, DB_PATH

@pytest.fixture(autouse=True)
def setup_and_teardown():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    yield
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)

def test_upload_endpoint():
    client = TestClient(app)
    sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
    
    with open(sample_json_path, "rb") as f:
        response = client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

    assert response.status_code == 200
    res_data = response.json()
    assert res_data["status"] == "ok"
    assert res_data["total_rows"] == 1480

    con = duckdb.connect(DB_PATH)
    count = con.execute("SELECT count(*) FROM history").fetchone()[0]
    assert count == 1480
    con.close()
