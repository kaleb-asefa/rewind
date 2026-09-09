"""Rewind API application entrypoint.

Assembles the FastAPI app from domain routers. Business logic lives in the
`routers` package (upload/image, overview metrics, explore metrics) and in
`metrics.py` (pure computation). This module only wires them together.
"""

import os

from database import lifespan as database_lifespan
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import explore, overview, upload

# Re-exported so existing tests can reach them as `main._enrich_session` /
# `main._WEEKDAY_NAMES` after the router split.
from metrics import _WEEKDAY_NAMES  # noqa: F401
from routers.upload import _enrich_session  # noqa: F401

app = FastAPI(title="Rewind API", lifespan=database_lifespan)

# We authenticate with a custom header (X-Rewind-Session), not cookies, so
# credentials stay off and "*" + credentials (invalid/unsafe) is avoided. The
# allowlist is env-driven; default "null" keeps file:// dev working.
_origins = os.getenv("REWIND_ALLOWED_ORIGINS", "null").split(",")

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
