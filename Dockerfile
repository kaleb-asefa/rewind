FROM python:3.13-slim

# Install uv directly from the official image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Environment settings
ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PORT=8000 \
    REWIND_ALLOWED_ORIGINS="*" \
    REWIND_DUCKDB_MEMORY_LIMIT="2GB" \
    REWIND_CATALOG_PATH="/app/data/metadata/catalog_sorted.parquet"

WORKDIR /app

# Copy dependency specifications first to leverage Docker layer caching
COPY backend/pyproject.toml backend/uv.lock backend/README.md ./backend/

# Install dependencies into /app/backend/.venv
RUN cd backend && uv sync --frozen --no-dev --no-install-project

# Copy application source code
COPY backend ./backend
COPY src ./src
COPY *.html ./
COPY Makefile README.md ./

# Create data directories for persistence
RUN mkdir -p /app/data/sessions /app/data/metadata

# Place the virtualenv binaries (uvicorn, duckdb, etc.) on PATH
ENV PATH="/app/backend/.venv/bin:$PATH"

EXPOSE 8000

# Healthcheck to verify the server is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/').read()" || exit 1

# Start the application
CMD ["uvicorn", "main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]

