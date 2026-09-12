"""ragui — FastAPI application factory."""
from __future__ import annotations

import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .database import close_db, init_db
from .routers import chat, health, ingest, knowledge, sessions
from .services.entities import recover_extraction_jobs
from .utils.auth import require_api_token
from .utils.logger import get_logger, setup_logging
from .utils.ratelimit import SlidingWindowLimiter, client_ip

log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(settings.log_level)
    await init_db()
    # Durable extraction queue: restart jobs orphaned by a previous process.
    try:
        recovered = await recover_extraction_jobs()
    except Exception as exc:
        recovered = 0
        log.error("app.recovery_failed", error=str(exc))
    log.info("app.started", environment=settings.environment, recovered_extractions=recovered)
    yield
    await close_db()
    log.info("app.stopped")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="RagUi",
        version="1.0.0",
        description="Retrieval-Augmented Generation UI backend",
        lifespan=lifespan,
        docs_url=None if settings.api_auth_token else "/docs",  # keep docs private when locked down
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    limiter = SlidingWindowLimiter(settings.rate_limit_per_minute)
    graph_limiter = SlidingWindowLimiter(settings.rate_limit_graph_per_minute)
    # Vector-search GETs bypass the mutation limiter — cap them separately.
    EXPENSIVE_GETS = {"/api/knowledge/graph"}

    @app.middleware("http")
    async def rate_limit(request: Request, call_next):
        # Health stays open (probes); CORS preflight is exempt by design.
        if request.method in ("POST", "PUT", "DELETE") and request.url.path.startswith("/api"):
            if not limiter.allow(client_ip(request)):
                log.warning("ratelimit.blocked", path=request.url.path)
                return JSONResponse(status_code=429, content={"detail": "Too many requests — slow down."})
        elif request.method == "GET" and request.url.path in EXPENSIVE_GETS:
            if not graph_limiter.allow(client_ip(request)):
                log.warning("ratelimit.graph_blocked", path=request.url.path)
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Graph endpoint rate limit exceeded — slow down."},
                )
        return await call_next(request)

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        if request.url.path != "/api/health":  # keep noise down
            log.info(
                "http.request",
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                latency_ms=elapsed_ms,
            )
        return response

    # /health must stay unauthenticated for Docker/K8s probes; everything else
    # requires the bearer token when API_AUTH_TOKEN is configured.
    protected = [Depends(require_api_token)] if settings.api_auth_token else []
    app.include_router(health.router, prefix="/api", tags=["system"])
    app.include_router(ingest.router, prefix="/api", tags=["ingest"], dependencies=protected)
    app.include_router(chat.router, prefix="/api", tags=["chat"], dependencies=protected)
    app.include_router(knowledge.router, prefix="/api", tags=["knowledge"], dependencies=protected)
    app.include_router(sessions.router, prefix="/api", tags=["sessions"], dependencies=protected)

    return app


app = create_app()
