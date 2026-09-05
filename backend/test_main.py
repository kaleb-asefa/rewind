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


def test_artist_rank_trends_allow_enter_leave():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")})

        res = client.get("/api/metrics/artist-rank?limit=8")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"

        n = len(data["months"])
        assert n > 0
        off_chart = 9  # limit + 1

        # Featured = union of everyone who ever reached the top 8 across months,
        # so a multi-year history yields more than the 8 all-time leaders.
        assert len(data["data"]) > 8

        for item in data["data"]:
            assert len(item["monthly_ranks"]) == n
            assert all(1 <= r <= off_chart for r in item["monthly_ranks"])

        # Visible ranks each month are a contiguous 1..k prefix (k <= 8); the rest
        # are off-chart. This is the enter/leave that shows artists rise and flop.
        for m in range(n):
            visible = sorted(
                item["monthly_ranks"][m]
                for item in data["data"]
                if item["monthly_ranks"][m] <= 8
            )
            assert visible == list(range(1, len(visible) + 1))
            assert len(visible) <= 8

        # At least one artist is off-chart at some point (a genuine flop / not-yet).
        assert any(off_chart in item["monthly_ranks"] for item in data["data"])


def test_bar_race_endpoint():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")})

        res = client.get("/api/metrics/bar-race?entity=artist&limit=10")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["entity"] == "artist"
        assert data["unit"] == "minutes"
        n = data["total_months"]
        assert n > 0
        assert len(data["months"]) == n
        assert len(data["data"]) >= 1

        first = data["data"][0]
        assert first["rank"] == 1
        assert "name" in first
        assert len(first["cumulative_minutes"]) == n

        # Cumulative series is monotonically non-decreasing (bars only grow).
        for item in data["data"]:
            cum = item["cumulative_minutes"]
            assert all(cum[i] <= cum[i + 1] + 1e-9 for i in range(len(cum) - 1))

        # Final frame == all-time leaderboard: rank 1's last value is the max.
        finals = [item["cumulative_minutes"][-1] for item in data["data"]]
        assert first["cumulative_minutes"][-1] == max(finals)


def test_bar_race_track_and_album_and_invalid():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        track = client.get("/api/metrics/bar-race?entity=track&limit=5").json()
        assert track["status"] == "ok"
        assert "artist_name" in track["data"][0]

        album = client.get("/api/metrics/bar-race?entity=album&limit=5").json()
        assert album["status"] == "ok"
        assert "artist_name" in album["data"][0]

        bad = client.get("/api/metrics/bar-race?entity=bogus")
        assert bad.status_code == 400


def test_heatmap_empty_when_no_history():
    with TestClient(app) as client:
        res = client.get("/api/metrics/heatmap")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["years"] == []
        assert data["year"] is None
        assert data["days"] == []


def test_heatmap_returns_daily_activity():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")})

        res = client.get("/api/metrics/heatmap")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"

        years = data["years"]
        assert len(years) >= 1
        assert years == sorted(years)
        # Default (no query param) returns the most recent year.
        assert data["year"] == years[-1]

        days = data["days"]
        assert len(days) == data["active_days"]
        assert data["total_streams"] == sum(d["streams"] for d in days)

        for d in days:
            assert len(d["date"]) == 10  # YYYY-MM-DD
            assert d["date"].startswith(str(data["year"]))
            assert d["streams"] >= 1
            assert 1 <= d["level"] <= 4
            assert d["minutes"] >= 0

        # Active days are strictly within the requested year and sorted ascending.
        iso_dates = [d["date"] for d in days]
        assert iso_dates == sorted(iso_dates)
        assert data["max_streams"] == max(d["streams"] for d in days)


def test_heatmap_specific_year_selectable():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")})

        years = client.get("/api/metrics/heatmap").json()["years"]
        earliest = years[0]
        res = client.get(f"/api/metrics/heatmap?year={earliest}").json()
        assert res["year"] == earliest
        assert all(d["date"].startswith(str(earliest)) for d in res["days"])

        # An out-of-range year falls back to the most recent year present.
        fallback = client.get("/api/metrics/heatmap?year=1999").json()
        assert fallback["year"] == years[-1]


def test_total_songs_endpoint():
    with TestClient(app) as client:
        res = client.get("/api/metrics/total-songs")
        assert res.status_code == 200
        assert res.json() == {"status": "ok", "total_songs": 0}

        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")})

        res = client.get("/api/metrics/total-songs")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["total_songs"] > 0


def test_active_day_endpoint():
    with TestClient(app) as client:
        empty = client.get("/api/metrics/active-day").json()
        assert empty["status"] == "ok"
        assert empty["weekday"] is None

        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")})

        res = client.get("/api/metrics/active-day")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["weekday"] in {
            "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
        }
        assert data["average_minutes"] > 0
        assert data["total_minutes"] >= data["average_minutes"]


def test_rhythm_empty_when_no_history():
    with TestClient(app) as client:
        data = client.get("/api/metrics/rhythm").json()
        assert data["status"] == "ok"
        assert data["hourly"] == [0] * 24
        assert data["weekday"] == [0] * 7
        assert data["monthly"] == [0] * 12
        assert data["peak_hour"] is None
        assert data["busiest_weekday"] is None
        assert data["total_streams"] == 0
        assert data["chronotype"] == {"label": None, "position": 0.0}
        assert data["streak"] == {"longest": 0, "current": 0, "active_days": 0}


def test_rhythm_returns_patterns():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")})

        data = client.get("/api/metrics/rhythm").json()
        assert data["status"] == "ok"
        assert len(data["hourly"]) == 24
        assert len(data["weekday"]) == 7
        assert len(data["monthly"]) == 12

        total = data["total_streams"]
        assert total > 0
        # hourly is the play count split, so it must sum to the total streams.
        assert sum(data["hourly"]) == total
        assert sum(data["weekday"]) == total
        assert sum(data["monthly"]) == total

        assert 0 <= data["peak_hour"] <= 23
        assert data["hourly"][data["peak_hour"]] == max(data["hourly"])
        assert data["busiest_weekday"] in set(main._WEEKDAY_NAMES.values())

        chrono = data["chronotype"]
        assert chrono["label"] in {"Early bird", "Balanced", "Night owl"}
        assert 0.0 <= chrono["position"] <= 1.0

        streak = data["streak"]
        assert streak["active_days"] >= 1
        assert streak["longest"] >= 1
        assert streak["longest"] >= streak["current"]












