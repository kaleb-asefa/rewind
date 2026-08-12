# Rewind — Backend Quickstart & Overview

The Rewind backend is a **FastAPI** web service powered by **DuckDB** and **SQLAlchemy Core** for analyzing Spotify Extended Streaming History data.

## Getting Started

### Prerequisites
- Python 3.12+ (managed via `uv`)

### Development Server
To start the FastAPI backend server in development mode:

```bash
cd backend

# Option 1: Configure backend/.env file (recommended):
cp .env.example .env
# Edit .env and set HF_TOKEN=hf_...

uv run fastapi dev main.py

# Option 2: Pass environment variable inline:
HF_TOKEN=hf_your_token_here uv run fastapi dev main.py
```

The server will start at `http://127.0.0.1:8000`. API documentation (Swagger UI) is available at `http://127.0.0.1:8000/docs`.

### Running Tests
To run the automated Pytest suite:

```bash
cd backend
uv run pytest
```

---

## File Overview

- `main.py`: FastAPI entrypoint defining ingestion (`POST /api/upload`), metric endpoints (`/api/metrics/*`), and enrichment status (`/api/enrichment-status`). Auto-triggers metadata enrichment after upload.
- `database.py`: Manages the FastAPI engine lifecycle (`app.state.engine`), lazy table reflection (`TableRegistry`), and connection dependency (`get_db`).
- `config.py`: Centralized Pydantic BaseSettings configuration module. Automatically loads secrets and variables from `backend/.env`.
- `load.py`: Metadata enrichment pipeline — fetches audio features/genre from Embeat (HuggingFace), images from Spotify oEmbed & Deezer, and release dates from Deezer. Results cached in `data/metadata.duckdb`.
- `.env.example` / `.env`: Template and local environment files for secrets like `HF_TOKEN`.
- `test_main.py`: Integration test suite testing ingestion, multi-file uploads, and all active metric endpoints using pytest and FastAPI TestClient.
- `pyproject.toml`: Dependency specification managed by `uv`.

---

## Related Documentation

- For backend architecture, ingestion workflow, and endpoint specifications, see [`BACKEND.md`](../docs/BACKEND.md).
- For the DuckDB table schema and column mapping decisions, see [`SCHEMA.md`](../docs/SCHEMA.md).
