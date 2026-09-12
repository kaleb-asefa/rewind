import functools
import io
import os
import sys
import tempfile

import duckdb
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func
import catalog
import covers
import database
import images
import main
import metrics
from database import table_registry
from main import app
from routers import upload as upload_router

# Every /api request now carries a session ticket; tests use a fixed valid UUID.
TEST_TICKET = "00000000-0000-4000-8000-000000000000"

_BOUNDARY = "testboundary"


def _multipart_body(payload: bytes) -> tuple[bytes, dict]:
    """Hand-roll a multipart upload body so it can be sent without Content-Length."""
    body = (
        f"--{_BOUNDARY}\r\n"
        'Content-Disposition: form-data; name="file"; filename="h.json"\r\n'
        "Content-Type: application/json\r\n\r\n"
    ).encode() + payload + f"\r\n--{_BOUNDARY}--\r\n".encode()
    return body, {
        "Content-Type": f"multipart/form-data; boundary={_BOUNDARY}",
        "X-Rewind-Session": TEST_TICKET,
    }


def _reset_state():
    """Clear the per-ticket engine cache and reflection registry between tests."""
    database._engine_cache.dispose_all()
    table_registry._tables.clear()


@pytest.fixture(autouse=True)
def setup_and_teardown(tmp_path, monkeypatch):
    # Each test gets an isolated sessions dir; tickets map to files inside it.
    monkeypatch.setattr(database, "SESSIONS_DIR", str(tmp_path))
    # Default: no catalog, so uploads skip enrichment (fast). Enrichment test overrides this.
    monkeypatch.setattr(catalog, "CATALOG_PATH", str(tmp_path / "no_catalog.parquet"))
    # Never touch the network in tests. The upload prewarm + image endpoints fetch
    # Spotify oEmbed covers over HTTP, which otherwise blocks every upload test on
    # dozens of real requests. Image tests override this stub with their own fetch.
    monkeypatch.setattr(images, "_fetch_thumbnail", lambda kind, sid: None)
    # Inject the ticket header on every TestClient by default so existing tests
    # need no per-call change; individual requests can still override it.
    monkeypatch.setattr(
        sys.modules[__name__],
        "TestClient",
        functools.partial(TestClient, headers={"X-Rewind-Session": TEST_TICKET}),
    )
    _reset_state()
    # Convenience handle for tests that query the session's engine directly.
    app.state.engine = database.get_engine(TEST_TICKET)
    yield
    _reset_state()

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
        history = table_registry.get_history_table(engine, TEST_TICKET)

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


def test_batch_retries_transient_then_caches(monkeypatch):
    """A cold batch where the first oEmbed pass rate-limits still returns every
    cover in one call, and persists them (never caches the transient miss)."""
    import threading

    monkeypatch.setattr(images, "_BATCH_BACKOFF", 0)  # no real sleeps in tests

    attempts: dict[str, int] = {}
    lock = threading.Lock()

    def flaky_fetch(kind, sid):
        if sid == "D":
            return None  # genuine art-less id — should cache as '' with no retry
        with lock:
            attempts[sid] = attempts.get(sid, 0) + 1
            n = attempts[sid]
        if n == 1:
            raise TimeoutError("simulated rate-limit")  # transient on first pass
        return f"https://img/{kind}/{sid}.jpg"

    monkeypatch.setattr(images, "_fetch_thumbnail", flaky_fetch)

    con = duckdb.connect()
    result = images.get_or_fetch_many(con, "artist", ["A", "B", "C", "D"])

    assert result == {
        "A": "https://img/artist/A.jpg",
        "B": "https://img/artist/B.jpg",
        "C": "https://img/artist/C.jpg",
        "D": None,  # genuine miss surfaces as None
    }

    rows = {
        r[0]: r[1]
        for r in con.execute(
            "SELECT spotify_id, image_url FROM images WHERE kind = 'artist'"
        ).fetchall()
    }
    # A/B/C persisted after the retry; D cached as '' (genuine miss, not a retry).
    assert rows == {
        "A": "https://img/artist/A.jpg",
        "B": "https://img/artist/B.jpg",
        "C": "https://img/artist/C.jpg",
        "D": "",
    }


def test_prewarm_retries_transient_across_passes(monkeypatch):
    """prewarm keeps retrying a transient miss across passes until it caches,
    and never caches an id while it is still failing."""
    import threading

    monkeypatch.setattr(images, "_BATCH_RETRIES", 0)  # let prewarm's own loop do the retrying
    monkeypatch.setattr(images, "_PREWARM_BACKOFF", 0)

    attempts: dict[str, int] = {}
    lock = threading.Lock()

    def flaky_fetch(kind, sid):
        with lock:
            attempts[sid] = attempts.get(sid, 0) + 1
            n = attempts[sid]
        if n < 3:  # fail the first two passes, succeed on the third
            raise ConnectionError("simulated transient")
        return f"https://img/{kind}/{sid}.jpg"

    monkeypatch.setattr(images, "_fetch_thumbnail", flaky_fetch)

    con = duckdb.connect()
    images.prewarm_session_covers(con, {"track": ["X"]})

    row = con.execute(
        "SELECT image_url FROM images WHERE kind = 'track' AND spotify_id = 'X'"
    ).fetchone()
    assert row is not None and row[0] == "https://img/track/X.jpg"
    assert attempts["X"] == 3  # two transient failures, cached on the third pass


def test_upload_prewarms_top_covers(monkeypatch):
    """After an upload the top track covers are cached without the client asking."""
    fetched: dict[str, int] = {}

    def fake_fetch(kind, sid):
        fetched[sid] = fetched.get(sid, 0) + 1
        return f"https://img/{kind}/{sid}.jpg"

    monkeypatch.setattr(images, "_fetch_thumbnail", fake_fetch)

    with TestClient(app) as client:
        sample_json_path = os.path.join(
            os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json"
        )
        with open(sample_json_path, "rb") as f:
            resp = client.post(
                "/api/upload",
                files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")},
            )
        assert resp.status_code == 200

        # TestClient runs background tasks after the response; the top tracks
        # should now be cached in the session images table.
        engine = app.state.engine
        with engine.connect() as conn:
            raw = conn.connection.driver_connection
            cached = raw.execute(
                "SELECT count(*) FROM images WHERE kind = 'track'"
            ).fetchone()[0]
        assert cached > 0


def test_inline_image_url_on_charts_and_ranks(tmp_path, monkeypatch):
    """chart / artist-rank / track-rank / bar-race return each item's cached cover
    inline (url for a hit, null for a '' miss and for uncached ids) and never fetch."""

    def boom(*args, **kwargs):
        raise AssertionError("oEmbed fetch must not happen in chart/rank endpoints")

    # Any synchronous fetch inside these endpoints would blow up the test.
    monkeypatch.setattr(images, "_safe_fetch", boom)

    with TestClient(app) as client:
        sample = os.path.join(
            os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json"
        )
        with open(sample, "rb") as f:
            resp = client.post(
                "/api/upload",
                files={"file": (os.path.basename(sample), f, "application/json")},
            )
        assert resp.status_code == 200

        engine = app.state.engine

        # Enrich against a fixture catalog so artist_id / album_id exist (track ids
        # come straight from history). Ids are synthetic but stable per name.
        with engine.connect() as conn:
            raw = conn.connection.driver_connection
            rows = raw.execute(
                "SELECT replace(track_uri, 'spotify:track:', '') AS tid, "
                "any_value(track_name), any_value(artist_name), any_value(album_name) "
                "FROM history WHERE track_uri LIKE 'spotify:track:%' GROUP BY tid"
            ).fetchall()

        fixture = str(tmp_path / "catalog_fixture.parquet")
        fx = duckdb.connect()
        fx.execute(
            "CREATE TABLE c (track_id VARCHAR, track_name VARCHAR, artist_name VARCHAR, "
            "artist_id VARCHAR, album_name VARCHAR, album_id VARCHAR)"
        )
        fx.executemany(
            "INSERT INTO c VALUES (?, ?, ?, ?, ?, ?)",
            [
                (tid, tn, an, f"art_{an}", alb, f"alb_{alb}_{an}")
                for tid, tn, an, alb in rows
            ],
        )
        fx.execute(f"COPY c TO '{fixture}' (FORMAT PARQUET)")
        fx.close()

        monkeypatch.setattr(catalog, "CATALOG_PATH", fixture)
        with engine.connect() as conn:
            main._enrich_session(conn)

        HIT = "https://cover/hit.jpg"

        def seed_images(kind, hit_id, miss_id):
            """Fresh cache with exactly one hit (url) and one '' miss for `kind`."""
            with engine.connect() as conn:
                raw = conn.connection.driver_connection
                images._ensure_table(raw)
                raw.execute("DELETE FROM images")
                raw.execute(
                    "INSERT INTO images (kind, spotify_id, image_url, fetched_at) "
                    "VALUES (?, ?, ?, now())",
                    [kind, hit_id, HIT],
                )
                raw.execute(
                    "INSERT INTO images (kind, spotify_id, image_url, fetched_at) "
                    "VALUES (?, ?, ?, now())",
                    [kind, miss_id, ""],
                )
                conn.commit()

        def assert_inline(path, kind, get_items):
            # Discover the ids this endpoint returns, then seed a hit + a '' miss.
            items = get_items(client.get(path).json())
            ids = [it["id"] for it in items if it.get("id")]
            assert len(set(ids)) >= 2, f"{path}: need >=2 distinct ids to test hit+miss"
            hit_id, miss_id = ids[0], next(i for i in ids if i != ids[0])
            seed_images(kind, hit_id, miss_id)

            items = get_items(client.get(path).json())
            saw_hit = saw_miss = saw_uncached = False
            for it in items:
                assert "image_url" in it  # additive field present on every item
                iid = it.get("id")
                if iid == hit_id:
                    assert it["image_url"] == HIT
                    saw_hit = True
                elif iid == miss_id:
                    assert it["image_url"] is None  # '' → null, not ''
                    saw_miss = True
                else:
                    assert it["image_url"] is None  # uncached / id-less → null
                    saw_uncached = True
            assert saw_hit and saw_miss and saw_uncached

        assert_inline("/api/metrics/chart?entity=track&limit=50", "track", lambda d: d["items"])
        assert_inline("/api/metrics/chart?entity=artist&limit=50", "artist", lambda d: d["items"])
        assert_inline("/api/metrics/chart?entity=album&limit=50", "album", lambda d: d["items"])
        assert_inline("/api/metrics/track-rank?limit=12", "track", lambda d: d["data"])
        assert_inline("/api/metrics/artist-rank?limit=12", "artist", lambda d: d["data"])
        assert_inline("/api/metrics/bar-race?entity=track&limit=12", "track", lambda d: d["data"])
        assert_inline("/api/metrics/bar-race?entity=artist&limit=12", "artist", lambda d: d["data"])
        assert_inline("/api/metrics/bar-race?entity=album&limit=12", "album", lambda d: d["data"])

        # Genre has no cover: image_url is present and null on every item.
        genre = client.get("/api/metrics/chart?entity=genre&limit=20").json()
        assert all(it["image_url"] is None for it in genre["items"])


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


def test_audio_empty_when_unenriched():
    with TestClient(app) as client:
        data = client.get("/api/metrics/audio").json()
        assert data["status"] == "ok"
        assert data["avg"] is None
        assert data["tracks"] == []
        assert data["coverage"] == 0.0


def test_audio_returns_profile_from_track_features(tmp_path, monkeypatch):
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        engine = app.state.engine
        with engine.connect() as conn:
            raw = conn.connection.driver_connection
            ids = [
                r[0]
                for r in raw.execute(
                    "SELECT DISTINCT replace(track_uri, 'spotify:track:', '') FROM history "
                    "WHERE track_uri LIKE 'spotify:track:%' LIMIT 5"
                ).fetchall()
            ]
        assert len(ids) >= 3

        fixture = str(tmp_path / "audio_fixture.parquet")
        fx = duckdb.connect()
        fx.execute(
            "CREATE TABLE c (track_id VARCHAR, track_name VARCHAR, artist_genres VARCHAR, "
            "energy DOUBLE, valence DOUBLE, danceability DOUBLE, acousticness DOUBLE, "
            "instrumentalness DOUBLE, tempo DOUBLE, mode INTEGER)"
        )
        # Primary genre r&b → energy is de-inflated by 0.12 (0.6 → 0.48).
        fx.executemany(
            "INSERT INTO c VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [(i, f"name_{i}", "r&b, pop", 0.6, 0.4, 0.7, 0.2, 0.05, 120.0, 1) for i in ids],
        )
        fx.execute(f"COPY c TO '{fixture}' (FORMAT PARQUET)")
        fx.close()
        monkeypatch.setattr(catalog, "CATALOG_PATH", fixture)

        with engine.connect() as conn:
            main._enrich_session(conn)

        data = client.get("/api/metrics/audio").json()
        assert data["status"] == "ok"
        assert data["avg"] is not None
        # r&b-primary energy 0.6 de-inflated to 0.48.
        assert data["avg"]["energy"] == 0.48
        assert data["avg"]["vocal"] == round(1 - 0.05, 3)
        assert data["tempo_avg"] == 120
        assert data["mode"]["major"] == 1.0
        assert data["matched"] > 0
        assert 0 < data["coverage"] <= 1
        assert len(data["tracks"]) >= 1
        for t in data["tracks"]:
            assert 0 <= t["valence"] <= 1
            assert 0 <= t["energy"] <= 1
            assert t["plays"] >= 1


def test_taste_empty_when_unenriched():
    with TestClient(app) as client:
        data = client.get("/api/metrics/taste").json()
        assert data["status"] == "ok"
        assert data["genres"] == []
        assert data["mainstream"] is None
        assert data["distinct_genres"] == 0
        assert data["eras"] == []
        assert data["gems"] == []


def test_taste_returns_profile_from_track_features(tmp_path, monkeypatch):
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        engine = app.state.engine
        with engine.connect() as conn:
            raw = conn.connection.driver_connection
            ids = [
                r[0]
                for r in raw.execute(
                    "SELECT DISTINCT replace(track_uri, 'spotify:track:', '') FROM history "
                    "WHERE track_uri LIKE 'spotify:track:%' LIMIT 6"
                ).fetchall()
            ]
        assert len(ids) >= 4

        fixture = str(tmp_path / "taste_fixture.parquet")
        fx = duckdb.connect()
        fx.execute(
            "CREATE TABLE c (track_id VARCHAR, track_name VARCHAR, artist_name VARCHAR, "
            "artist_genres VARCHAR, popularity DOUBLE, release_year INTEGER)"
        )
        # Two clear umbrella genres + a low-popularity gem candidate.
        rows = []
        for idx, tid in enumerate(ids):
            genre = "conscious hip hop, rap" if idx % 2 == 0 else "r&b, pop"
            pop = 0.2 if idx == 0 else 0.8  # first track is an obscure gem
            year = 2012 if idx % 2 == 0 else 2021
            rows.append((tid, f"name_{idx}", f"artist_{idx}", genre, pop, year))
        fx.executemany("INSERT INTO c VALUES (?, ?, ?, ?, ?, ?)", rows)
        fx.execute(f"COPY c TO '{fixture}' (FORMAT PARQUET)")
        fx.close()
        monkeypatch.setattr(catalog, "CATALOG_PATH", fixture)

        with engine.connect() as conn:
            main._enrich_session(conn)

        data = client.get("/api/metrics/taste").json()
        assert data["status"] == "ok"
        names = [g["name"] for g in data["genres"]]
        assert "Hip-Hop" in names and "R&B" in names
        for g in data["genres"]:
            assert g["plays"] >= 1
        assert 0 <= data["mainstream"] <= 1
        assert data["distinct_genres"] >= 2
        assert all(e["decade"] % 10 == 0 for e in data["eras"])
        assert data["avg_year"] and 1900 < data["avg_year"] < 2100
        for gem in data["gems"]:
            assert gem["plays"] >= 5


def test_behavior_empty_when_no_history():
    with TestClient(app) as client:
        data = client.get("/api/metrics/behavior").json()
        assert data["status"] == "ok"
        assert data["shuffle"] is None
        assert data["loops"] == []


def test_behavior_returns_habits_from_history():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        data = client.get("/api/metrics/behavior").json()
        assert data["status"] == "ok"
        assert 0 <= data["shuffle"] <= 1
        assert 0 <= data["skip_rate"] <= 1
        att = data["attention"]
        assert 0 <= att["under30"] <= 1
        assert 0 <= att["partial"] <= 1
        assert 0 <= att["finished"] <= 1
        # Buckets partition every play, so they sum to ~1.
        assert abs((att["under30"] + att["partial"] + att["finished"]) - 1) < 0.05
        assert data["longest_binge_min"] >= 0
        for loop in data["loops"]:
            assert loop["count"] >= 2


def test_discovery_empty_when_no_history():
    with TestClient(app) as client:
        data = client.get("/api/metrics/discovery").json()
        assert data == {
            "status": "ok",
            "year": None,
            "new_artist_share": 0.0,
            "new_artists_monthly": 0.0,
            "one_off_share": 0.0,
            "rediscoveries": [],
            "rising": [],
        }


def test_discovery_returns_history_patterns():
    with TestClient(app) as client:
        sample_json_path = os.path.join(
            os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json"
        )
        with open(sample_json_path, "rb") as f:
            client.post(
                "/api/upload",
                files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")},
            )

        data = client.get("/api/metrics/discovery").json()
        assert data["status"] == "ok"
        assert 0 <= data["new_artist_share"] <= 1
        assert data["new_artists_monthly"] >= 0
        assert 0 <= data["one_off_share"] <= 1
        for item in data["rediscoveries"]:
            assert item["name"] and item["artist"]
            assert item["plays"] >= 2
            assert item["id"] and len(item["id"]) == 22
        for item in data["rising"]:
            assert item["name"]
            assert item["share"] > 0
            assert "id" in item


def test_listening_life_empty_when_no_history():
    with TestClient(app) as client:
        data = client.get("/api/metrics/listening-life").json()
        assert data == {
            "status": "ok",
            "year": None,
            "peaks": [],
            "typical_session_minutes": 0,
            "session_mix": [],
            "milestones": [],
        }


def test_listening_life_returns_history_moments():
    with TestClient(app) as client:
        sample_json_path = os.path.join(
            os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json"
        )
        with open(sample_json_path, "rb") as f:
            client.post(
                "/api/upload",
                files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")},
            )

        data = client.get("/api/metrics/listening-life").json()
        assert data["status"] == "ok"
        assert [peak["label"] for peak in data["peaks"]] == ["Day", "Week", "Month"]
        assert all(peak["minutes"] > 0 and peak["period"] for peak in data["peaks"])
        assert data["typical_session_minutes"] >= 0
        assert [item["label"] for item in data["session_mix"]] == [
            "Under 15m", "15-30m", "30-60m", "Over 1h"
        ]
        assert abs(sum(item["share"] for item in data["session_mix"]) - 1) < 0.01
        assert [item["target"] for item in data["milestones"]] == [1000, 5000, 10000]
        assert all(item["date"] and item["track"] for item in data["milestones"])


def test_over_time_empty_when_no_history():
    with TestClient(app) as client:
        data = client.get("/api/metrics/over-time").json()
        assert data == {
            "status": "ok",
            "year": None,
            "years": [],
            "music_age": {},
            "time_machine": {},
            "nostalgia": [],
        }


def test_over_time_returns_years_and_catalog(tmp_path, monkeypatch):
    with TestClient(app) as client:
        sample_json_path = os.path.join(
            os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json"
        )
        with open(sample_json_path, "rb") as f:
            client.post(
                "/api/upload",
                files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")},
            )

        # Years come from history alone (work before enrichment).
        data = client.get("/api/metrics/over-time").json()
        assert data["status"] == "ok"
        assert len(data["years"]) >= 1
        for y in data["years"]:
            assert isinstance(y["year"], int)
            assert y["top_artist"]["name"]
            assert y["top_track"]["name"] and y["top_track"]["id"]
            assert y["summer_track"]["name"]

        # Enrich with a fixture carrying release years so the catalog parts populate.
        engine = app.state.engine
        with engine.connect() as conn:
            raw = conn.connection.driver_connection
            ids = [
                r[0]
                for r in raw.execute(
                    "SELECT DISTINCT replace(track_uri, 'spotify:track:', '') FROM history "
                    "WHERE track_uri LIKE 'spotify:track:%' LIMIT 8"
                ).fetchall()
            ]
        assert len(ids) >= 4

        fixture = str(tmp_path / "over_time_fixture.parquet")
        fx = duckdb.connect()
        fx.execute(
            "CREATE TABLE c (track_id VARCHAR, track_name VARCHAR, artist_name VARCHAR, "
            "release_year INTEGER)"
        )
        rows = []
        for idx, tid in enumerate(ids):
            year = 1975 if idx == 0 else 2024 if idx == 1 else 2000 + idx
            rows.append((tid, f"name_{idx}", f"artist_{idx}", year))
        fx.executemany("INSERT INTO c VALUES (?, ?, ?, ?)", rows)
        fx.execute(f"COPY c TO '{fixture}' (FORMAT PARQUET)")
        fx.close()
        monkeypatch.setattr(catalog, "CATALOG_PATH", fixture)

        with engine.connect() as conn:
            main._enrich_session(conn)

        data = client.get("/api/metrics/over-time").json()
        age = data["music_age"]
        assert 0 <= age["fresh_share"] <= 1
        assert 1900 < age["avg_year"] < 2100

        machine = data["time_machine"]
        assert machine["oldest"]["year"] == 1975
        assert machine["oldest"]["year"] <= machine["newest"]["year"]

        assert data["nostalgia"]
        for point in data["nostalgia"]:
            assert point["period"] and 1900 < point["avg_year"] < 2100

        # A year filter narrows the highlights to that year and flips the
        # nostalgia trend from year-by-year to month-by-month inside it.
        target = data["years"][0]["year"]
        scoped = client.get(f"/api/metrics/over-time?year={target}").json()
        assert scoped["year"] == target
        assert [y["year"] for y in scoped["years"]] == [target]
        assert scoped["nostalgia"]
        assert all(p["period"] in set(metrics._MONTH_ABBR) for p in scoped["nostalgia"])


def test_evolution_empty_when_no_history():
    with TestClient(app) as client:
        data = client.get("/api/metrics/evolution").json()
        assert data == {
            "status": "ok",
            "year": None,
            "genre_evolution": {"periods": [], "genres": []},
            "mood_trend": [],
            "day_night": {},
            "mainstream_trend": [],
        }


def test_evolution_returns_trends_from_track_features(tmp_path, monkeypatch):
    with TestClient(app) as client:
        sample_json_path = os.path.join(
            os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json"
        )
        with open(sample_json_path, "rb") as f:
            client.post(
                "/api/upload",
                files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")},
            )

        engine = app.state.engine
        with engine.connect() as conn:
            raw = conn.connection.driver_connection
            ids = [
                r[0]
                for r in raw.execute(
                    "SELECT DISTINCT replace(track_uri, 'spotify:track:', '') FROM history "
                    "WHERE track_uri LIKE 'spotify:track:%' LIMIT 8"
                ).fetchall()
            ]
        assert len(ids) >= 4

        fixture = str(tmp_path / "evolution_fixture.parquet")
        fx = duckdb.connect()
        fx.execute(
            "CREATE TABLE c (track_id VARCHAR, track_name VARCHAR, artist_name VARCHAR, "
            "artist_genres VARCHAR, valence DOUBLE, energy DOUBLE, popularity DOUBLE)"
        )
        rows = []
        for idx, tid in enumerate(ids):
            genre = "conscious hip hop, rap" if idx % 2 == 0 else "r&b, pop"
            rows.append((tid, f"name_{idx}", f"artist_{idx}", genre, 0.5, 0.6, 0.7))
        fx.executemany("INSERT INTO c VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
        fx.execute(f"COPY c TO '{fixture}' (FORMAT PARQUET)")
        fx.close()
        monkeypatch.setattr(catalog, "CATALOG_PATH", fixture)

        with engine.connect() as conn:
            main._enrich_session(conn)

        data = client.get("/api/metrics/evolution").json()
        assert data["status"] == "ok"
        evo = data["genre_evolution"]
        assert evo["periods"] and evo["genres"]
        n = len(evo["periods"])
        names = [g["name"] for g in evo["genres"]]
        assert "Hip-Hop" in names and "R&B" in names
        for g in evo["genres"]:
            assert len(g["shares"]) == n
            assert all(0 <= s <= 1 for s in g["shares"])
        # Each period is a 100% stack, so its shares sum to ~1.
        for j in range(n):
            assert abs(sum(g["shares"][j] for g in evo["genres"]) - 1) < 0.02

        for point in data["mood_trend"]:
            assert point["period"] and 0 <= point["valence"] <= 1
        for point in data["mainstream_trend"]:
            assert point["period"] and 0 <= point["popularity"] <= 1
        for key in ("morning", "night"):
            if key in data["day_night"]:
                assert 0 <= data["day_night"][key]["energy"] <= 1

        # Inside one year the same trends switch to month-by-month periods.
        target = int(evo["periods"][0])
        scoped = client.get(f"/api/metrics/evolution?year={target}").json()
        assert scoped["year"] == target
        months = set(metrics._MONTH_ABBR)
        assert scoped["genre_evolution"]["periods"]
        assert all(p in months for p in scoped["genre_evolution"]["periods"])
        assert all(p["period"] in months for p in scoped["mood_trend"])


def test_sound_detail_empty_when_no_history():
    with TestClient(app) as client:
        data = client.get("/api/metrics/sound-detail").json()
        assert data == {
            "status": "ok",
            "year": None,
            "tempo": {"buckets": []},
            "key": {},
            "danceable": [],
            "energy_split": {},
        }


def test_sound_detail_returns_profile_from_track_features(tmp_path, monkeypatch):
    with TestClient(app) as client:
        sample_json_path = os.path.join(
            os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json"
        )
        with open(sample_json_path, "rb") as f:
            client.post(
                "/api/upload",
                files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")},
            )

        # Enrich the most-played tracks so the danceable list (plays >= 5) fills.
        engine = app.state.engine
        with engine.connect() as conn:
            raw = conn.connection.driver_connection
            ids = [
                r[0]
                for r in raw.execute(
                    "SELECT replace(track_uri, 'spotify:track:', '') AS id, COUNT(*) AS c "
                    "FROM history WHERE track_uri LIKE 'spotify:track:%' "
                    "GROUP BY id ORDER BY c DESC LIMIT 8"
                ).fetchall()
            ]
        assert len(ids) >= 4

        fixture = str(tmp_path / "sound_detail_fixture.parquet")
        fx = duckdb.connect()
        fx.execute(
            "CREATE TABLE c (track_id VARCHAR, track_name VARCHAR, artist_name VARCHAR, "
            "artist_genres VARCHAR, tempo DOUBLE, mode INTEGER, danceability DOUBLE, energy DOUBLE)"
        )
        rows = []
        for idx, tid in enumerate(ids):
            genre = "r&b, pop" if idx % 2 else "pop"
            rows.append(
                (tid, f"name_{idx}", f"artist_{idx}", genre, 80 + idx * 12, idx % 2, 0.9 - idx * 0.03, 0.3 + idx * 0.08)
            )
        fx.executemany("INSERT INTO c VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows)
        fx.execute(f"COPY c TO '{fixture}' (FORMAT PARQUET)")
        fx.close()
        monkeypatch.setattr(catalog, "CATALOG_PATH", fixture)

        with engine.connect() as conn:
            main._enrich_session(conn)

        data = client.get("/api/metrics/sound-detail").json()
        assert data["status"] == "ok"
        buckets = data["tempo"]["buckets"]
        assert [b["label"] for b in buckets] == ["Slow", "Relaxed", "Steady", "Upbeat", "Fast"]
        assert sum(b["plays"] for b in buckets) > 0
        assert 0 <= data["key"]["major_share"] <= 1
        assert data["danceable"]
        for t in data["danceable"]:
            assert t["name"] and t["id"]
            assert 0 <= t["danceability"] <= 1
        es = data["energy_split"]
        assert abs(es["workout"] + es["wind_down"] - 1) < 0.01


def test_deep_cuts_empty_when_no_history():
    with TestClient(app) as client:
        data = client.get("/api/metrics/deep-cuts").json()
        assert data == {
            "status": "ok",
            "year": None,
            "concentration": {},
            "album_commitment": {},
            "top_day_track": {},
            "no_skip": {},
        }


def test_deep_cuts_returns_history_patterns():
    with TestClient(app) as client:
        sample_json_path = os.path.join(
            os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json"
        )
        with open(sample_json_path, "rb") as f:
            client.post(
                "/api/upload",
                files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")},
            )

        data = client.get("/api/metrics/deep-cuts").json()
        assert data["status"] == "ok"
        assert 0 <= data["concentration"]["top10_share"] <= 1
        assert 0 <= data["album_commitment"]["deep_share"] <= 1

        day = data["top_day_track"]
        assert day["name"] and day["artist"]
        assert day["id"] and len(day["id"]) == 22
        assert day["count"] >= 1 and day["date"]

        no_skip = data["no_skip"]
        assert no_skip["name"] and no_skip["id"] and len(no_skip["id"]) == 22
        assert no_skip["plays"] >= 5
        assert 0 <= no_skip["skip_rate"] <= 1


def test_wrapped_empty_when_no_history():
    with TestClient(app) as client:
        data = client.get("/api/metrics/wrapped").json()
        assert data == {
            "status": "ok",
            "year": None,
            "personality": [],
        }


def test_wrapped_returns_personality(tmp_path, monkeypatch):
    with TestClient(app) as client:
        sample_json_path = os.path.join(
            os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json"
        )
        with open(sample_json_path, "rb") as f:
            client.post(
                "/api/upload",
                files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")},
            )

        # Personality is history-driven (>= 4 traits before enrichment).
        data = client.get("/api/metrics/wrapped").json()
        assert data["status"] == "ok"
        assert len(data["personality"]) >= 4
        for trait in data["personality"]:
            assert trait["label"] and trait["left"] and trait["right"] and trait["icon"]
            assert 0 <= trait["position"] <= 1

        # Enrich with popularity + duration so the mainstream trait and extremes fill.
        engine = app.state.engine
        with engine.connect() as conn:
            raw = conn.connection.driver_connection
            ids = [
                r[0]
                for r in raw.execute(
                    "SELECT replace(track_uri, 'spotify:track:', '') AS id, COUNT(*) AS c "
                    "FROM history WHERE track_uri LIKE 'spotify:track:%' "
                    "GROUP BY id ORDER BY c DESC LIMIT 8"
                ).fetchall()
            ]
        assert len(ids) >= 4

        fixture = str(tmp_path / "wrapped_fixture.parquet")
        fx = duckdb.connect()
        fx.execute(
            "CREATE TABLE c (track_id VARCHAR, track_name VARCHAR, artist_name VARCHAR, "
            "popularity DOUBLE, duration DOUBLE)"
        )
        rows = [
            (tid, f"name_{idx}", f"artist_{idx}", 0.7, 200 + idx * 20)
            for idx, tid in enumerate(ids)
        ]
        fx.executemany("INSERT INTO c VALUES (?, ?, ?, ?, ?)", rows)
        fx.execute(f"COPY c TO '{fixture}' (FORMAT PARQUET)")
        fx.close()
        monkeypatch.setattr(catalog, "CATALOG_PATH", fixture)

        with engine.connect() as conn:
            main._enrich_session(conn)

        data = client.get("/api/metrics/wrapped").json()
        assert any(t["right"] == "Mainstream" for t in data["personality"])


# ── Explore year filter ───────────────────────────────────────────────────────
_EXPLORE_ENDPOINTS = (
    "artist-rank", "track-rank", "bar-race", "rhythm", "audio", "taste",
    "behavior", "discovery", "listening-life", "over-time", "evolution",
    "sound-detail", "deep-cuts", "wrapped",
)


def test_years_empty_when_no_history():
    with TestClient(app) as client:
        assert client.get("/api/metrics/years").json() == {"status": "ok", "years": []}


def test_years_lists_history_years_newest_first():
    with TestClient(app) as client:
        sample_json_path = os.path.join(
            os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json"
        )
        with open(sample_json_path, "rb") as f:
            client.post(
                "/api/upload",
                files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")},
            )

        years = client.get("/api/metrics/years").json()["years"]
        assert len(years) >= 2
        assert [y["year"] for y in years] == sorted((y["year"] for y in years), reverse=True)
        for y in years:
            assert isinstance(y["year"], int)


def test_year_filter_partitions_history():
    """Every play belongs to exactly one year, so the per-year splits of a
    history-only metric must add back up to the all-time numbers."""
    with TestClient(app) as client:
        sample_json_path = os.path.join(
            os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json"
        )
        with open(sample_json_path, "rb") as f:
            client.post(
                "/api/upload",
                files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")},
            )

        years = client.get("/api/metrics/years").json()["years"]
        assert len(years) >= 2
        all_time = client.get("/api/metrics/rhythm").json()
        assert all_time["year"] is None

        per_year = {}
        for y in years:
            scoped = client.get(f"/api/metrics/rhythm?year={y['year']}").json()
            assert scoped["status"] == "ok"
            assert scoped["year"] == y["year"]
            # A single year can never hold more plays than the whole history.
            assert 0 < scoped["total_streams"] < all_time["total_streams"]
            per_year[y["year"]] = scoped["total_streams"]

        assert sum(per_year.values()) == all_time["total_streams"]


def test_year_filter_with_no_data_returns_empty_state():
    with TestClient(app) as client:
        sample_json_path = os.path.join(
            os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json"
        )
        with open(sample_json_path, "rb") as f:
            client.post(
                "/api/upload",
                files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")},
            )

        # A year the session has no plays in is an honest empty state, not a 500.
        rhythm = client.get("/api/metrics/rhythm?year=1999").json()
        assert rhythm["status"] == "ok"
        assert rhythm["year"] == 1999
        assert rhythm["total_streams"] == 0
        assert rhythm["hourly"] == [0] * 24

        behavior = client.get("/api/metrics/behavior?year=1999").json()
        assert behavior["status"] == "ok" and behavior["shuffle"] is None

        deep = client.get("/api/metrics/deep-cuts?year=1999").json()
        assert deep["status"] == "ok" and deep["concentration"] == {}


def test_year_filter_scopes_every_explore_endpoint():
    with TestClient(app) as client:
        sample_json_path = os.path.join(
            os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json"
        )
        with open(sample_json_path, "rb") as f:
            client.post(
                "/api/upload",
                files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")},
            )

        target = client.get("/api/metrics/years").json()["years"][0]["year"]
        for endpoint in _EXPLORE_ENDPOINTS:
            res = client.get(f"/api/metrics/{endpoint}?year={target}")
            assert res.status_code == 200, endpoint
            data = res.json()
            assert data["status"] == "ok", endpoint
            # Every endpoint echoes the applied filter (null = all time).
            assert data["year"] == target, endpoint
            assert client.get(f"/api/metrics/{endpoint}").json()["year"] is None, endpoint

        # The climb chapter's frames must stay inside the selected year.
        race = client.get(f"/api/metrics/bar-race?year={target}").json()
        assert race["months"]
        assert all(m.startswith(str(target)) for m in race["months"])


def test_year_filter_rejects_invalid_values():
    with TestClient(app) as client:
        for endpoint in _EXPLORE_ENDPOINTS:
            assert client.get(f"/api/metrics/{endpoint}?year=bogus").status_code == 400, endpoint
            assert client.get(f"/api/metrics/{endpoint}?year=99").status_code == 400, endpoint
            assert client.get(f"/api/metrics/{endpoint}?year=2024a").status_code == 400, endpoint
            # "all" is the documented default and must stay accepted.
            assert client.get(f"/api/metrics/{endpoint}?year=all").status_code == 200, endpoint


def test_chart_empty_when_no_history():
    with TestClient(app) as client:
        data = client.get("/api/metrics/chart?entity=artist").json()
        assert data["status"] == "ok"
        assert data["entity"] == "artist"
        assert data["sort"] == "minutes"
        assert data["range"] == "all"
        assert data["items"] == []
        assert data["years"] == []


def test_chart_ranks_artists_from_history():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        data = client.get("/api/metrics/chart?entity=artist&sort=minutes&limit=10").json()
        assert data["status"] == "ok"
        items = data["items"]
        assert 1 <= len(items) <= 10
        assert items[0]["rank"] == 1
        assert items[0]["name"] is not None
        assert items[0]["minutes"] > 0
        assert items[0]["share"] == 1.0  # top item is the reference for the share bar
        # Ranks are contiguous 1..N and minutes are non-increasing.
        assert [it["rank"] for it in items] == list(range(1, len(items) + 1))
        mins = [it["minutes"] for it in items]
        assert all(mins[i] >= mins[i + 1] for i in range(len(mins) - 1))
        # All-time has no previous period → movement undefined.
        assert all(it["prev_rank"] is None for it in items)
        assert len(data["years"]) >= 1


def test_chart_sort_streams_reorders():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        by_streams = client.get("/api/metrics/chart?entity=artist&sort=streams&limit=10").json()
        assert by_streams["sort"] == "streams"
        streams = [it["streams"] for it in by_streams["items"]]
        assert all(streams[i] >= streams[i + 1] for i in range(len(streams) - 1))


def test_chart_track_album_and_invalid():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        track = client.get("/api/metrics/chart?entity=track&limit=5").json()
        assert track["items"][0]["artist"] is not None
        assert track["items"][0]["id"] and len(track["items"][0]["id"]) == 22

        album = client.get("/api/metrics/chart?entity=album&limit=5").json()
        assert album["items"][0]["artist"] is not None

        assert client.get("/api/metrics/chart?entity=bogus").status_code == 400
        assert client.get("/api/metrics/chart?entity=artist&sort=bogus").status_code == 400
        assert client.get("/api/metrics/chart?entity=artist&range=bogus").status_code == 400


def test_chart_year_range_reports_movement():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2022-2025_0.json", f, "application/json")})

        years = client.get("/api/metrics/chart?entity=artist").json()["years"]
        assert len(years) >= 2
        # Pick a year that has a prior year in the data so movement is defined.
        target = sorted(years)[-1]
        data = client.get(f"/api/metrics/chart?entity=artist&range={target}&limit=10").json()
        assert data["range"] == str(target)
        assert len(data["items"]) >= 1
        # prev_rank is either an int (was present last year) or None (NEW / absent).
        for it in data["items"]:
            assert it["prev_rank"] is None or isinstance(it["prev_rank"], int)


def test_chart_genre_from_track_features(tmp_path, monkeypatch):
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        # Unenriched → genre chart is empty (frontend keeps its sample).
        assert client.get("/api/metrics/chart?entity=genre").json()["items"] == []

        engine = app.state.engine
        with engine.connect() as conn:
            raw = conn.connection.driver_connection
            ids = [
                r[0]
                for r in raw.execute(
                    "SELECT DISTINCT replace(track_uri, 'spotify:track:', '') FROM history "
                    "WHERE track_uri LIKE 'spotify:track:%' LIMIT 6"
                ).fetchall()
            ]
        assert len(ids) >= 4

        fixture = str(tmp_path / "chart_genre_fixture.parquet")
        fx = duckdb.connect()
        fx.execute(
            "CREATE TABLE c (track_id VARCHAR, track_name VARCHAR, artist_name VARCHAR, "
            "artist_genres VARCHAR, artist_id VARCHAR, album_name VARCHAR, album_id VARCHAR)"
        )
        rows = []
        for idx, tid in enumerate(ids):
            genre = "conscious hip hop, rap" if idx % 2 == 0 else "r&b, pop"
            rows.append((tid, f"name_{idx}", f"artist_{idx}", genre, f"aid_{idx}", f"album_{idx}", f"alid_{idx}"))
        fx.executemany("INSERT INTO c VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
        fx.execute(f"COPY c TO '{fixture}' (FORMAT PARQUET)")
        fx.close()
        monkeypatch.setattr(catalog, "CATALOG_PATH", fixture)

        with engine.connect() as conn:
            main._enrich_session(conn)

        data = client.get("/api/metrics/chart?entity=genre&sort=streams").json()
        names = [it["name"] for it in data["items"]]
        assert "Hip-Hop" in names and "R&B" in names
        assert data["items"][0]["rank"] == 1
        assert data["items"][0]["share"] == 1.0


def test_chart_merges_artist_name_variants():
    # Stylized spellings of one artist ("Giveon" vs "GIVĒON") must collapse
    # into a single row, keeping the most-played spelling.
    from routers.explore import _chart_rank_history

    con = duckdb.connect()
    con.execute("CREATE TABLE history (artist_name VARCHAR, ms_played BIGINT)")
    con.execute(
        "INSERT INTO history VALUES ('Giveon', 100000), ('Giveon', 100000), "
        "('GIV\u0112ON', 50000), ('Beyoncé', 30000), ('Beyonce', 20000)"
    )
    rows = _chart_rank_history(con, "artist", "ms", "", 0)
    con.close()

    names = [r["name"] for r in rows]
    assert "Giveon" in names          # most-played spelling wins
    assert "GIVĒON" not in names       # variant merged away
    giveon = next(r for r in rows if r["name"] == "Giveon")
    assert giveon["streams"] == 3      # 2 + 1 plays merged
    assert giveon["ms"] == 250000
    # Beyoncé / Beyonce also fold together (accent-insensitive).
    assert sum(1 for r in rows if r["name"].lower().startswith("beyonc")) == 1


def test_canonical_artist_rows_merge_name_variants():
    # The velocity + bar-race feeds must also collapse stylized artist spellings
    # ("Giveon" vs "GIVĒON") into one entity, with a stable display per period.
    from routers.explore import _canonical_artist_rows

    con = duckdb.connect()
    con.execute(
        "CREATE TABLE history (artist_name VARCHAR, ts TIMESTAMP, ms_played BIGINT)"
    )
    con.execute(
        "INSERT INTO history VALUES "
        "('Giveon', TIMESTAMP '2024-02-05 10:00', 100000),"   # week of Feb 5
        "('GIV\u0112ON', TIMESTAMP '2024-02-06 10:00', 100000),"
        "('Giveon', TIMESTAMP '2024-02-12 10:00', 100000)"    # next week
    )
    rows = _canonical_artist_rows(con, "week")
    con.close()

    assert {r[1] for r in rows} == {"Giveon"}   # merged, stable across weeks
    assert len(rows) == 2                        # one row per week
    assert sum(r[3] for r in rows) == 3          # streams counted across spellings
    assert sum(r[2] for r in rows) == 300000     # ms merged


def _album_refs_con(with_features=True):
    """Raw DuckDB with a synthetic history (+ optional catalog slice) for cover tests."""
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE history (track_uri VARCHAR, album_name VARCHAR, "
        "artist_name VARCHAR, ms_played BIGINT)"
    )
    if with_features:
        con.execute(
            "CREATE TABLE track_features (track_id VARCHAR, album_name VARCHAR, "
            "artist_name VARCHAR, album_id VARCHAR)"
        )
    return con


def test_album_cover_refs_survive_name_divergence():
    # Spotify's export and the catalog name the same album differently
    # ("Take Care" vs "Take Care (Deluxe)", "Giveon" vs "GIVĒON"). Resolution
    # goes through track_uri, so the names never have to agree.
    con = _album_refs_con()
    con.execute(
        "INSERT INTO history VALUES "
        "('spotify:track:t1', 'Take Care', 'Drake', 100000),"
        "('spotify:track:t2', 'TAKE TIME', 'Giveon', 50000)"
    )
    con.execute(
        "INSERT INTO track_features VALUES "
        "('t1', 'Take Care (Deluxe)', 'Drake', 'alb_takecare'),"
        "('t2', 'TAKE TIME', 'GIV\u0112ON', 'alb_taketime')"
    )
    refs = covers.album_cover_refs(con)
    con.close()

    assert refs[("Take Care", "Drake")] == ("alb_takecare", "album", "alb_takecare")
    assert refs[("TAKE TIME", "Giveon")] == ("alb_taketime", "album", "alb_taketime")


def test_album_cover_refs_pick_most_played_edition():
    # One history album mapping to several catalog album ids must resolve to the
    # edition actually listened to, not an arbitrary MAX().
    con = _album_refs_con()
    con.execute(
        "INSERT INTO history VALUES "
        "('spotify:track:t1', 'TAKE TIME', 'Giveon', 10000),"
        "('spotify:track:t2', 'TAKE TIME', 'Giveon', 900000)"
    )
    con.execute(
        "INSERT INTO track_features VALUES "
        "('t1', 'TAKE TIME', 'Giveon', 'zzz_rarely_played'),"
        "('t2', 'TAKE TIME', 'Giveon', 'aaa_most_played')"
    )
    refs = covers.album_cover_refs(con)
    con.close()

    assert refs[("TAKE TIME", "Giveon")][0] == "aaa_most_played"


def test_album_cover_refs_fall_back_to_track_when_catalog_lacks_release():
    # An album newer than the catalog snapshot has no album_id at all. Its art is
    # still reachable through one of its own tracks (a track's oEmbed thumbnail
    # *is* the album cover), so the cover ref switches kind instead of going null.
    con = _album_refs_con()
    con.execute(
        "INSERT INTO history VALUES "
        "('spotify:track:t1', 'BELOVED', 'GIV\u0112ON', 10000),"
        "('spotify:track:t2', 'BELOVED', 'GIV\u0112ON', 800000)"
    )
    refs = covers.album_cover_refs(con)
    con.close()

    album_id, kind, cover_id = refs[("BELOVED", "GIVĒON")]
    assert album_id is None      # honest: the catalog really has no album id
    assert kind == "track"
    assert cover_id == "t2"      # most-played track represents the album

    # …and that fallback is what gets pre-warmed.
    con = _album_refs_con()
    con.execute("INSERT INTO history VALUES ('spotify:track:t2', 'BELOVED', 'G', 1)")
    assert covers.album_fallback_track_ids(con) == ["t2"]
    con.close()


def test_album_cover_refs_work_without_any_catalog():
    # No track_features table (catalog missing entirely): albums still get covers
    # through their tracks rather than silently losing all artwork.
    con = _album_refs_con(with_features=False)
    con.execute(
        "INSERT INTO history VALUES ('spotify:track:t9', 'Some Album', 'Artist', 5000)"
    )
    refs = covers.album_cover_refs(con)
    con.close()

    assert refs[("Some Album", "Artist")] == (None, "track", "t9")


def test_top_album_exposes_cover_ref():
    with TestClient(app) as client:
        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2022-2025_0.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("h.json", f, "application/json")})

        data = client.get("/api/metrics/top-album").json()
        assert data["status"] == "ok"
        # Unenriched (no catalog in this test) → no album_id, but the cover ref
        # still points at a real track so the frontend can render artwork.
        assert data["cover_kind"] == "track"
        assert data["cover_id"]


def test_superlative_obsession_counts_peak_day_and_ignores_skips():
    from routers.explore import _superlative_obsession

    con = duckdb.connect()
    con.execute(
        "CREATE TABLE history (track_uri VARCHAR, track_name VARCHAR, "
        "artist_name VARCHAR, ts TIMESTAMP, ms_played BIGINT)"
    )
    con.execute(
        "INSERT INTO history VALUES "
        "('spotify:track:aaa','Loved','Artist A', TIMESTAMP '2024-02-03 10:00', 120000),"
        "('spotify:track:aaa','Loved','Artist A', TIMESTAMP '2024-02-03 11:00', 120000),"
        "('spotify:track:aaa','Loved','Artist A', TIMESTAMP '2024-02-03 12:00', 120000),"
        "('spotify:track:aaa','Loved','Artist A', TIMESTAMP '2024-02-05 09:00', 120000),"
        "('spotify:track:bbb','Skipped','Artist B', TIMESTAMP '2024-02-04 09:00', 5000),"
        "('spotify:track:bbb','Skipped','Artist B', TIMESTAMP '2024-02-04 09:05', 5000)"
    )
    rows = _superlative_obsession(con, 0, "", 10)
    con.close()

    assert len(rows) == 1                    # only the qualifying track
    assert rows[0]["name"] == "Loved"
    assert rows[0]["count"] == 3             # 3 plays on the peak day
    assert rows[0]["date"] == "2024-02-03"
    assert rows[0]["id"] == "aaa"
    assert all(r["name"] != "Skipped" for r in rows)  # <30s plays never count


def test_superlative_binges_clusters_sessions():
    from routers.explore import _superlative_binges

    con = duckdb.connect()
    con.execute(
        "CREATE TABLE history (track_uri VARCHAR, artist_name VARCHAR, ts TIMESTAMP)"
    )
    con.execute(
        "INSERT INTO history VALUES "
        "('spotify:track:a1','A', TIMESTAMP '2024-03-01 20:00'),"
        "('spotify:track:a2','A', TIMESTAMP '2024-03-01 20:20'),"
        "('spotify:track:a3','A', TIMESTAMP '2024-03-01 20:40'),"
        "('spotify:track:b1','B', TIMESTAMP '2024-03-01 21:00'),"  # 60-min session, mostly A
        "('spotify:track:c1','C', TIMESTAMP '2024-03-02 10:00'),"  # >30-min gap → new session
        "('spotify:track:c2','C', TIMESTAMP '2024-03-02 10:10')"   # only 10 min, below the floor
    )
    rows = _superlative_binges(con, 0, "", 10)
    con.close()

    assert len(rows) == 1              # the short session is filtered out
    assert rows[0]["minutes"] == 60
    assert rows[0]["name"] == "A"      # dominant artist
    assert rows[0]["plays"] == 4
    assert rows[0]["artist_pct"] == 75  # A is 3 of the 4 plays
    assert rows[0]["date"] == "2024-03-01"


def test_superlative_skip_charts():
    from routers.explore import (
        _skip_stats,
        _superlative_most_skipped,
        _superlative_never_skipped,
    )

    con = duckdb.connect()
    con.execute(
        "CREATE TABLE history (track_uri VARCHAR, track_name VARCHAR, "
        "artist_name VARCHAR, reason_end VARCHAR)"
    )
    rows = (
        [("spotify:track:h", "Hate", "A", "fwdbtn")] * 5
        + [("spotify:track:h", "Hate", "A", "trackdone")]        # 6 plays, 5 skips = 83%
        + [("spotify:track:m", "Meh", "B", "fwdbtn")] * 2
        + [("spotify:track:m", "Meh", "B", "trackdone")] * 3     # 5 plays, 2 skips = 40%
        + [("spotify:track:l", "Loved", "C", "trackdone")] * 12  # 12 plays, 0 skips
        + [("spotify:track:x", "LowPlays", "D", "fwdbtn")] * 3   # 3 plays: under the floor
    )
    con.executemany("INSERT INTO history VALUES (?, ?, ?, ?)", rows)
    stats = _skip_stats(con, "")
    con.close()

    most = _superlative_most_skipped(stats, 10)
    assert most[0]["name"] == "Hate"
    assert most[0]["skip_pct"] == 83
    assert most[0]["plays"] == 6
    assert [m["name"] for m in most] == ["Hate", "Meh"]   # LowPlays/Loved excluded
    assert all(m["name"] != "LowPlays" for m in most)     # below the 5-play floor

    never = _superlative_never_skipped(stats, 10)
    assert [n["name"] for n in never] == ["Loved"]        # only 10+ plays, 0 skips
    assert never[0]["plays"] == 12


def test_superlatives_endpoint():
    with TestClient(app) as client:
        empty = client.get("/api/metrics/superlatives").json()
        assert empty["obsession"] == []

        sample_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json")
        with open(sample_json_path, "rb") as f:
            client.post("/api/upload", files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")})

        data = client.get("/api/metrics/superlatives?limit=10").json()
        assert data["status"] == "ok"
        assert data["range"] == "all"
        obs = data["obsession"]
        assert 1 <= len(obs) <= 10
        assert obs[0]["rank"] == 1
        assert obs[0]["count"] >= 1
        assert obs[0]["name"] and obs[0]["id"]
        assert len(obs[0]["date"]) == 10  # YYYY-MM-DD
        counts = [o["count"] for o in obs]
        assert all(counts[i] >= counts[i + 1] for i in range(len(counts) - 1))

        binges = data["binges"]
        assert isinstance(binges, list)
        if binges:
            assert binges[0]["minutes"] >= 20
            assert binges[0]["plays"] >= 1
            assert len(binges[0]["date"]) == 10
            bm = [b["minutes"] for b in binges]
            assert all(bm[i] >= bm[i + 1] for i in range(len(bm) - 1))

        skipped = data["most_skipped"]
        assert isinstance(skipped, list)
        if skipped:
            assert skipped[0]["plays"] >= 5
            assert 0 <= skipped[0]["skip_pct"] <= 100
            sp = [s["skip_pct"] for s in skipped]
            assert all(sp[i] >= sp[i + 1] for i in range(len(sp) - 1))

        never = data["never_skipped"]
        assert isinstance(never, list)
        if never:
            assert never[0]["plays"] >= 10
            npl = [n["plays"] for n in never]
            assert all(npl[i] >= npl[i + 1] for i in range(len(npl) - 1))

        assert client.get("/api/metrics/superlatives?range=bogus").status_code == 400


def test_session_isolation():
    """Two tickets → two isolated histories; neither sees the other's data."""
    ticket_a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    ticket_b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    with TestClient(app) as client:
        sample_json_path = os.path.join(
            os.path.dirname(__file__), "..", "data", "Streaming_History_Audio_2025_1.json"
        )
        with open(sample_json_path, "rb") as f:
            up = client.post(
                "/api/upload",
                files={"file": ("Streaming_History_Audio_2025_1.json", f, "application/json")},
                headers={"X-Rewind-Session": ticket_a},
            )
        assert up.status_code == 200

        # Ticket A sees its own data.
        res_a = client.get(
            "/api/metrics/total-time", headers={"X-Rewind-Session": ticket_a}
        )
        assert res_a.status_code == 200
        assert res_a.json()["total_minutes"] > 0

        # Ticket B has a separate (empty) file → the no-history empty state.
        res_b = client.get(
            "/api/metrics/total-time", headers={"X-Rewind-Session": ticket_b}
        )
        assert res_b.status_code == 400


def test_bad_ticket_rejected():
    """Missing / traversal / non-UUID tickets are rejected with 400 (no file escape)."""
    with TestClient(app) as client:
        for bad in ["", "../evil", "..", "not-a-uuid", "../../etc/passwd"]:
            res = client.get(
                "/api/metrics/total-time", headers={"X-Rewind-Session": bad}
            )
            assert res.status_code == 400, f"expected 400 for ticket {bad!r}"




















def test_upload_rejects_too_many_files(monkeypatch):
    """File count is capped before anything is streamed to disk."""
    monkeypatch.setattr(upload_router, "MAX_UPLOAD_FILES", 3)
    with TestClient(app) as client:
        files = [
            ("files", (f"h{i}.json", io.BytesIO(b"[]"), "application/json"))
            for i in range(4)
        ]
        res = client.post("/api/upload", files=files)
        assert res.status_code == 413
        assert "Too many files" in res.json()["detail"]


def test_upload_rejects_oversized_body(monkeypatch):
    """A body over the cap is refused up front via Content-Length."""
    monkeypatch.setattr(upload_router, "MAX_UPLOAD_BYTES", 1024)
    with TestClient(app) as client:
        big = io.BytesIO(b"x" * 4096)
        res = client.post(
            "/api/upload", files={"file": ("h.json", big, "application/json")}
        )
        assert res.status_code == 413
        assert "exceeds" in res.json()["detail"]


def test_upload_enforces_byte_cap_without_content_length(monkeypatch):
    """Content-Length is client-controlled, so the real byte count is capped too.

    Streams the body chunked (no Content-Length) so the middleware gate cannot
    fire, proving `_process_upload` independently enforces the limit.
    """
    monkeypatch.setattr(upload_router, "MAX_UPLOAD_BYTES", 1024)
    body, headers = _multipart_body(b"x" * 4096)

    def _chunks():
        yield body

    with TestClient(app) as client:
        res = client.post("/api/upload", content=_chunks(), headers=headers)
        assert "content-length" not in {
            k.lower() for k in res.request.headers
        }, "test must send a chunked body for this to prove anything"
        assert res.status_code == 413


def test_upload_cleans_up_temp_file_on_abort(monkeypatch, tmp_path):
    """An aborted copy must not leave its partial temp file behind."""
    monkeypatch.setattr(upload_router, "MAX_UPLOAD_BYTES", 1024)
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    with TestClient(app) as client:
        big = io.BytesIO(b"x" * 4096)
        client.post("/api/upload", files={"file": ("h.json", big, "application/json")})
    assert list(tmp_path.glob("*.json")) == []
