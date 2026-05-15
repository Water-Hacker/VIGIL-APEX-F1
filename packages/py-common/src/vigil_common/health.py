"""Lightweight FastAPI app exposing /healthz and /metrics.

The Prometheus exposition uses the default registry from
:mod:`prometheus_client`, which is the same registry our metrics module
populates.
"""

from __future__ import annotations

import asyncio
from typing import Any

import uvicorn
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest


def make_health_app(*, service: str) -> FastAPI:
    app = FastAPI(title=f"{service} health", docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/healthz", response_class=PlainTextResponse)
    async def healthz() -> str:
        return "ok"

    @app.get("/metrics")
    async def metrics() -> Response:
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return app


async def serve_health(*, service: str, port: int = 9100) -> asyncio.Task[Any]:
    """Start the health/metrics server as a background task. Returns the task."""
    app = make_health_app(service=service)
    config = uvicorn.Config(
        app,
        host="0.0.0.0",  # noqa: S104 — health/metrics must be reachable from container probes + Prometheus
        port=port,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    return asyncio.create_task(server.serve(), name=f"{service}-health")
