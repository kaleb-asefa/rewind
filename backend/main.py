"""Rewind API application entrypoint.

Assembles the FastAPI app from domain routers. Business logic lives in the
`routers` package (upload/image, overview metrics, explore metrics) and in
`metrics.py` (pure computation). This module only wires them together.
"""

from database import lifespan as database_lifespan
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import explore, overview, upload

# Re-exported so existing tests can reach them as `main._enrich_session` /
# `main._WEEKDAY_NAMES` after the router split.
from metrics import _WEEKDAY_NAMES  # noqa: F401
from routers.upload import _enrich_session  # noqa: F401

app = FastAPI(title="Rewind API", lifespan=database_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router)
app.include_router(overview.router)
app.include_router(explore.router)
