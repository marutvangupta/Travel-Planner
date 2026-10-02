"""FastAPI app factory."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..config import get_settings
from ..db import init_db
from ..services import rag
from ..services.watcher import watch_loop
from .routes import router

structlog.configure(wrapper_class=structlog.make_filtering_bound_logger(logging.INFO))


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN201
    get_settings().check_production()
    init_db()
    await asyncio.to_thread(rag.ensure_seeded)
    task = None
    if get_settings().weather_watch_interval_min > 0:
        task = asyncio.create_task(watch_loop())
    yield
    if task:
        task.cancel()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Travel Planner API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=False,
                       allow_methods=["*"], allow_headers=["*"])
    app.include_router(router)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
