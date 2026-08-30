import os
import duckdb
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func
import catalog
import database
import images
import main
from database import table_registry
from main import app


@pytest.fixture(autouse=True)
def setup_and_teardown(tmp_path, monkeypatch):
    session_db_path = str(tmp_path / "rewind.duckdb")
    monkeypatch.setattr(database, "DB_PATH", session_db_path)
    # Default: no catalog, so uploads skip enrichment (fast). Enrichment test overrides this.
    monkeypatch.setattr(catalog, "CATALOG_PATH", str(tmp_path / "no_catalog.parquet"))
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


def test_upload_skips_enrichment_when_catalog_missing():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            response = client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        assert response.status_code == 200
        assert response.json()["enrichment"]["status"] == "skipped"


def test_enrichment_builds_track_features_from_catalog(tmp_path, monkeypatch):
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        engine = app.state.engine

        # Grab a few real track_ids from the uploaded history
        with engine.connect() as conn:
            raw = conn.connection.driver_connection
            ids = [
                r[0]
                for r in raw.execute(
                    """
                    SELECT DISTINCT replace(track_uri, 'spotify:track:', '')
                    FROM history WHERE track_uri LIKE 'spotify:track:%' LIMIT 3
                    """
                ).fetchall()
            ]
        assert len(ids) == 3

        # Build a tiny fixture catalog containing exactly those ids
        fixture = str(tmp_path / "catalog_fixture.parquet")
        fx = duckdb.connect()
        fx.execute("CREATE TABLE c (track_id VARCHAR, track_name VARCHAR, energy DOUBLE)")
        fx.executemany(
            "INSERT INTO c VALUES (?, ?, ?)", [(i, f"name_{i}", 0.5) for i in ids]
        )
        fx.execute(f"COPY c TO '{fixture}' (FORMAT PARQUET)")
        fx.close()

        monkeypatch.setattr(catalog, "CATALOG_PATH", fixture)

        with engine.connect() as conn:
            result = main._enrich_session(conn)

        assert result["status"] == "ok"
        assert result["matched"] == 3
        assert result["total"] >= 3
        assert 0 < result["coverage"] <= 1

        with engine.connect() as conn:
            raw = conn.connection.driver_connection
            n = raw.execute("SELECT count(*) FROM track_features").fetchone()[0]
            assert n == 3
            cols = {r[0] for r in raw.execute("DESCRIBE track_features").fetchall()}
            assert {"track_id", "track_name", "energy"}.issubset(cols)


def test_top_track_returns_track_id():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        res = client.get("/api/metrics/top-track")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["track_name"] is not None
        # track_id comes straight from history's track_uri (Spotify base62 = 22 chars)
        assert data["track_id"] and len(data["track_id"]) == 22


def test_image_endpoint_fetches_and_caches(monkeypatch):
    calls = {"n": 0}

    def fake_fetch(kind, sid):
        calls["n"] += 1
        return f"https://img/{kind}/{sid}.jpg"

    monkeypatch.setattr(images, "_fetch_thumbnail", fake_fetch)

    with TestClient(app) as client:
        r1 = client.get("/api/image?kind=artist&id=ABC123")
        assert r1.status_code == 200
        assert r1.json()["image_url"] == "https://img/artist/ABC123.jpg"

        r2 = client.get("/api/image?kind=artist&id=ABC123")
        assert r2.json()["image_url"] == "https://img/artist/ABC123.jpg"
        assert calls["n"] == 1  # second hit served from cache, no refetch

        bad = client.get("/api/image?kind=bogus&id=X")
        assert bad.status_code == 400










