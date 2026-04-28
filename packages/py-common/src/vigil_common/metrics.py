"""Prometheus metrics — name-aligned with @vigil/observability.

Workers MUST use these singletons rather than declaring their own.
The metrics server is started by `serve_health()` (vigil_common.health).
"""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

events_consumed = Counter(
    "vigil_events_consumed_total",
    "Events pulled off a Redis stream by a worker",
    labelnames=("worker", "stream"),
)

events_emitted = Counter(
    "vigil_events_emitted_total",
    "Events written by a worker to a downstream stream",
    labelnames=("worker", "stream"),
)

dedup_hits = Counter(
    "vigil_dedup_hits_total",
    "Inputs rejected at the dedup boundary",
    labelnames=("worker",),
)

errors_total = Counter(
    "vigil_errors_total",
    "Errors classified by code",
    labelnames=("service", "code", "severity"),
)

processing_duration = Histogram(
    "vigil_processing_duration_seconds",
    "End-to-end processing latency for a unit of work",
    labelnames=("worker", "kind"),
    buckets=(0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300),
)

satellite_scenes_processed = Counter(
    "vigil_satellite_scenes_total",
    "Satellite scenes downloaded and analysed",
    labelnames=("source", "outcome"),
)

forensics_documents_processed = Counter(
    "vigil_forensics_documents_total",
    "Documents passed through the image-forensics pipeline",
    labelnames=("kind", "outcome"),
)

worker_inflight = Gauge(
    "vigil_worker_inflight",
    "Currently-in-flight work units for the worker",
    labelnames=("worker",),
)
