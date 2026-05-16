"""Tests for vigil_common.health — FastAPI app smoke test."""

from __future__ import annotations

from fastapi.testclient import TestClient

from vigil_common.health import make_health_app


def test_health_endpoint_returns_ok() -> None:
    app = make_health_app(service="vigil-test")
    client = TestClient(app)
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.text == "ok"


def test_metrics_endpoint_serves_prometheus_payload() -> None:
    app = make_health_app(service="vigil-test")
    client = TestClient(app)
    resp = client.get("/metrics")
    assert resp.status_code == 200
    # Prometheus content-type marker (text/plain; version=0.0.4)
    assert "text/plain" in resp.headers["content-type"]
    # Some metric names from our singletons should appear
    body = resp.text
    assert "vigil_events_consumed_total" in body or "vigil_worker_inflight" in body


def test_no_docs_endpoint() -> None:
    app = make_health_app(service="vigil-test")
    client = TestClient(app)
    # docs_url disabled
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
