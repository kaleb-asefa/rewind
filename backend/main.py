"""Rewind API application entrypoint.

Assembles the FastAPI app from domain routers. Business logic lives in the
`routers` package (upload/image, overview metrics, explore metrics) and in
`metrics.py` (pure computation). This module only wires them together.
"""

import os

from database import lifespan as database_lifespan
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from routers import explore, overview, upload

# Re-exported so existing tests can reach them as `main._enrich_session` /
# `main._WEEKDAY_NAMES` after the router split.
from metrics import _WEEKDAY_NAMES  # noqa: F401
from routers.upload import _enrich_session  # noqa: F401

app = FastAPI(title="Rewind API", lifespan=database_lifespan)

# Registered before CORSMiddleware so CORS ends up outermost (Starlette makes the
# most recently added middleware outermost) and the 413 below still gets CORS
# headers — otherwise the browser reports it as a generic network failure.
app.middleware("http")(upload.enforce_upload_size_limit)

# We authenticate with a custom header (X-Rewind-Session), not cookies, so
# credentials stay off and "*" + credentials (invalid/unsafe) is avoided. The
# allowlist is env-driven; defaults to "*" for easy docker/local deployment.
_origins_env = os.getenv("REWIND_ALLOWED_ORIGINS", "*")
_origins = [o.strip() for o in _origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],  # must allow X-Rewind-Session
)

app.include_router(upload.router)
app.include_router(overview.router)
app.include_router(explore.router)

# Static frontend serving
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.normpath(os.path.join(BASE_DIR, ".."))
SRC_DIR = os.path.join(FRONTEND_DIR, "src")

if os.path.isdir(SRC_DIR):
    app.mount("/src", StaticFiles(directory=SRC_DIR), name="src")


@app.get("/", include_in_schema=False)
async def serve_root():
    index_file = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.isfile(index_file):
        return FileResponse(index_file)
    return {"status": "ok", "message": "Rewind API is running"}


@app.get("/{page:path}", include_in_schema=False)
async def serve_page(page: str):
    clean_page = os.path.normpath(page).lstrip("/")
    if clean_page.startswith("api/"):
        return JSONResponse(status_code=404, content={"detail": "Not Found"})

    target = os.path.join(FRONTEND_DIR, clean_page)
    if not os.path.commonpath([FRONTEND_DIR, target]) == FRONTEND_DIR:
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    if os.path.isfile(target):
        return FileResponse(target)

    if not clean_page.endswith(".html"):
        html_target = f"{target}.html"
        if os.path.isfile(html_target):
            return FileResponse(html_target)

    if clean_page.endswith((".ico", ".png", ".jpg", ".jpeg", ".svg", ".map", ".json")):
        return JSONResponse(status_code=404, content={"detail": "Not Found"})

    index_file = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.isfile(index_file):
        return FileResponse(index_file)
    return JSONResponse(status_code=404, content={"detail": "Not Found"})

