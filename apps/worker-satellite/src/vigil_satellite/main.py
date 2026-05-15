"""worker-satellite entry point.

Consumes from `vigil:satellite:request`, runs the provider-chain STAC
fetch + activity computation, pins the result to IPFS, emits an audit
row via the Node audit-bridge sidecar, and finally publishes a
`satellite_imagery` event on `vigil:adapter:out` so the existing pattern
pipeline (P-D-001..P-D-005) picks it up.

Provider chain (default — DECISION-010):
    NICFI (4.77 m, free, requires PLANET_API_KEY)
  → Sentinel-2 L2A (10 m, free, MPC)
  → Sentinel-1 RTC SAR (10 m, free, MPC, cloud-penetrating)

Each provider's output is converted into a uniform `ProviderResult` plus
per-scene findings; the chain stops at the first provider that produces a
non-empty pair. Cost is tracked per request and bounded by
`SATELLITE_MAX_COST_PER_REQUEST_USD` — paid providers (Maxar / Airbus)
are gated off by default.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import cast

from pystac_client.exceptions import APIError

from vigil_common.config import Settings
from vigil_common.errors import VigilError
from vigil_common.health import serve_health
from vigil_common.logging import get_logger, init_logging
from vigil_common.metrics import satellite_scenes_processed
from vigil_common.redis_consumer import (
    Ack,
    DeadLetter,
    Envelope,
    HandlerOutcome,
    RedisStreamWorker,
    Retry,
)
from vigil_common.shutdown import install_shutdown, register_shutdown

from .activity import compute_activity
from .audit_bridge import AuditBridgeClient
from .ipfs import IpfsPinner
from .nicfi import search_nicfi_scenes
from .schemas import (
    ActivityFinding,
    GeoBBox,
    GeoPoint,
    PolygonGeoJson,
    Provider,
    SatelliteEventPayload,
    SatelliteRequest,
)
from .sentinel1 import (
    read_s1_vv_backscatter,
    s1_activity_score,
    search_s1_scenes,
)
from .stac import Scene, read_band, search_scenes

_logger = get_logger("worker-satellite")


@dataclass(frozen=True)
class ProviderResult:
    provider: Provider
    activity_score: float
    activity_centroid: GeoPoint | None
    findings: list[ActivityFinding]
    ndvi_delta: float | None
    ndbi_delta: float | None
    pixel_change_pct: float | None
    cost_usd: float


class SatelliteWorker(RedisStreamWorker[SatelliteRequest]):
    name = "worker-satellite"
    stream = "vigil:satellite:request"
    schema = SatelliteRequest
    concurrency = 2
    max_retries = 4

    def __init__(self, settings: Settings) -> None:
        super().__init__(
            redis_host=settings.redis_host,
            redis_port=settings.redis_port,
            redis_password_file=str(settings.redis_password_file),
            redis_db=settings.redis_db,
        )
        self._settings = settings
        self._audit = AuditBridgeClient(
            os.environ.get("AUDIT_BRIDGE_SOCKET", "/run/vigil/audit-bridge.sock"),
        )
        self._ipfs = IpfsPinner(
            os.environ.get("IPFS_API_URL", "http://vigil-ipfs:5001"),
        )

    async def handle(self, env: Envelope[SatelliteRequest]) -> HandlerOutcome:
        req = env.payload
        try:
            aoi = _polygon_to_bbox(req.aoi_geojson)
            mid = (
                req.contract_window.start
                + (req.contract_window.end - req.contract_window.start) * 0.10
            )
            late = (
                req.contract_window.start
                + (req.contract_window.end - req.contract_window.start) * 0.95
            )

            # Filter providers by cost ceiling — paid providers gated off
            # unless `max_cost_usd > 0`. NICFI is dropped when no API key.
            allowed: list[Provider] = []
            for p in req.providers:
                if p in ("maxar", "airbus") and req.max_cost_usd <= 0:
                    continue
                if p == "nicfi" and not os.environ.get("PLANET_API_KEY"):
                    continue
                allowed.append(p)
            if not allowed:
                return DeadLetter(
                    reason="no providers permitted under cost ceiling / credentials",
                )

            outcome: ProviderResult | None = None
            tried: list[str] = []
            for provider in allowed:
                tried.append(provider)
                try:
                    result = await asyncio.to_thread(
                        self._run_provider,
                        provider,
                        aoi,
                        mid,
                        late,
                        req.max_cloud_pct,
                    )
                    if result is not None and result.findings:
                        outcome = result
                        break
                except VigilError as ve:
                    _logger.info(
                        "provider-skipped",
                        provider=provider,
                        code=ve.code,
                        message=ve.message,
                    )
                    continue

            if outcome is None:
                satellite_scenes_processed.labels(source="any", outcome="no_pairs").inc()
                return Retry(
                    reason=f"no usable pairs from providers={tried}",
                    delay_ms=15 * 60_000,
                )

            payload_dict = {
                "request_id": req.request_id,
                "project_id": req.project_id,
                "finding_id": req.finding_id,
                "provider": outcome.provider,
                "activity_score": outcome.activity_score,
                "activity_centroid": (
                    outcome.activity_centroid.model_dump() if outcome.activity_centroid else None
                ),
                "ndvi_delta": outcome.ndvi_delta,
                "ndbi_delta": outcome.ndbi_delta,
                "pixel_change_pct": outcome.pixel_change_pct,
                "scene_findings": [f.model_dump(mode="json") for f in outcome.findings],
                "contract_window": {
                    "start": req.contract_window.start.isoformat(),
                    "end": req.contract_window.end.isoformat(),
                },
                "aoi_geojson": req.aoi_geojson.model_dump(),
                "cost_usd": outcome.cost_usd,
            }
            result_cid = await asyncio.to_thread(self._ipfs.pin_json, payload_dict)

            await asyncio.to_thread(
                self._audit.append,
                action="satellite.imagery_fetched",
                actor=f"worker-satellite/{req.requested_by}",
                subject_kind="finding" if req.finding_id else "system",
                subject_id=req.finding_id or req.project_id or req.request_id,
                payload={
                    "request_id": req.request_id,
                    "provider_used": outcome.provider,
                    "scene_count": len(outcome.findings),
                    "activity_score": outcome.activity_score,
                    "cost_usd": outcome.cost_usd,
                    "result_cid": result_cid,
                },
            )

            event_payload = SatelliteEventPayload(
                activity_score=outcome.activity_score,
                activity_centroid=outcome.activity_centroid,
                activity_trend=None,
                ndvi_delta=outcome.ndvi_delta,
                ndbi_delta=outcome.ndbi_delta,
                pixel_change_pct=outcome.pixel_change_pct,
                scene_findings=outcome.findings,
                contract_window=req.contract_window,
                aoi_geojson=req.aoi_geojson,
                provider=outcome.provider,
                cost_usd=outcome.cost_usd,
                result_cid=result_cid,
            )

            outbound = self.envelope_dict(
                producer=self.name,
                payload={
                    "kind": "satellite_imagery",
                    "source_id": "worker-satellite",
                    "subject_kind": "Project",
                    "project_id": req.project_id,
                    "finding_id": req.finding_id,
                    "data": event_payload.model_dump(mode="json"),
                    "activity_score": outcome.activity_score,
                    "activity_centroid": (
                        outcome.activity_centroid.model_dump()
                        if outcome.activity_centroid
                        else None
                    ),
                },
                dedup_key=f"sat:{req.request_id}",
                correlation_id=env.correlation_id,
            )
            await self.publish("vigil:adapter:out", outbound)

            _logger.info(
                "satellite-assessment-emitted",
                request_id=req.request_id,
                provider=outcome.provider,
                activity_score=outcome.activity_score,
                n_scenes=len(outcome.findings),
                result_cid=result_cid,
            )
            satellite_scenes_processed.labels(source=outcome.provider, outcome="ok").inc()
            return Ack()
        except APIError as e:
            return Retry(reason=f"STAC API error: {e}", delay_ms=10 * 60_000)
        except VigilError as ve:
            if ve.retryable:
                return Retry(reason=ve.message, delay_ms=15 * 60_000)
            return DeadLetter(reason=ve.message)

    def _run_provider(
        self,
        provider: Provider,
        aoi: GeoBBox,
        mid: datetime,
        late: datetime,
        max_cloud: float,
    ) -> ProviderResult | None:
        if provider == "nicfi":
            before = search_nicfi_scenes(aoi=aoi, when=mid, max_cloud=max_cloud)
            after = search_nicfi_scenes(aoi=aoi, when=late, max_cloud=max_cloud)
            return _ndvi_pipeline(before, after, aoi, provider="nicfi", cost=0.0)

        if provider == "sentinel-2":
            before = search_scenes(
                catalog_url=self._settings.stac_catalog_url,
                aoi=aoi,
                when=mid,
                sensors=("sentinel-2-l2a", "landsat-c2-l2"),
                max_cloud=max_cloud,
            )
            after = search_scenes(
                catalog_url=self._settings.stac_catalog_url,
                aoi=aoi,
                when=late,
                sensors=("sentinel-2-l2a", "landsat-c2-l2"),
                max_cloud=max_cloud,
            )
            return _ndvi_pipeline(before, after, aoi, provider="sentinel-2", cost=0.0)

        if provider == "sentinel-1":
            before = search_s1_scenes(
                catalog_url=self._settings.stac_catalog_url,
                aoi=aoi,
                when=mid,
            )
            after = search_s1_scenes(
                catalog_url=self._settings.stac_catalog_url,
                aoi=aoi,
                when=late,
            )
            return _s1_pipeline(before, after, aoi)

        # Maxar / Airbus paid hooks. Wired in as architecture extension points;
        # actual invocation is gated on procurement.
        raise VigilError(
            code="SATELLITE_PROVIDER_NOT_IMPLEMENTED",
            message=f"Provider '{provider}' not implemented in this build",
            severity="info",
            retryable=False,
        )


def _polygon_to_bbox(polygon: PolygonGeoJson) -> GeoBBox:
    ring = polygon.coordinates[0]
    if not ring or len(ring) < 4:
        raise VigilError(
            code="SATELLITE_INVALID_AOI",
            message="AOI polygon outer ring must have >= 4 coordinate pairs",
            severity="warn",
            retryable=False,
        )
    lons = [pt[0] for pt in ring]
    lats = [pt[1] for pt in ring]
    return GeoBBox(
        min_lon=min(lons),
        min_lat=min(lats),
        max_lon=max(lons),
        max_lat=max(lats),
    )


def _ndvi_pipeline(
    before: list[Scene],
    after: list[Scene],
    aoi: GeoBBox,
    *,
    provider: Provider,
    cost: float,
) -> ProviderResult | None:
    findings: list[ActivityFinding] = []
    best_score = 0.0
    best_centroid: GeoPoint | None = None
    best_ndvi_delta: float | None = None
    best_ndbi_delta: float | None = None
    best_pixel_change_pct: float | None = None
    for after_scene in after[:3]:
        same = [s for s in before if s.sensor == after_scene.sensor]
        if not same:
            continue
        before_scene = same[0]
        try:
            b_red = read_band(before_scene.bands["red"], aoi)
            b_nir = read_band(before_scene.bands["nir"], aoi)
            b_swir = read_band(before_scene.bands["swir"], aoi)
            a_red = read_band(after_scene.bands["red"], aoi)
            a_nir = read_band(after_scene.bands["nir"], aoi)
            a_swir = read_band(after_scene.bands["swir"], aoi)
        except VigilError as e:
            _logger.warning("band-read-failed", scene_id=after_scene.item_id, error=str(e))
            continue

        result = compute_activity(
            before_red=b_red,
            before_nir=b_nir,
            before_swir=b_swir,
            after_red=a_red,
            after_nir=a_nir,
            after_swir=a_swir,
        )
        ndvi_delta = result.ndvi_mean_after - result.ndvi_mean_before
        ndbi_delta = result.ndbi_mean_after - result.ndbi_mean_before
        centroid = _pixel_to_lonlat(result.centroid_pixel, aoi, b_red.shape)
        findings.append(
            ActivityFinding(
                scene_id=after_scene.item_id,
                sensor=after_scene.sensor,
                captured_at=after_scene.captured_at,
                cloud_pct=after_scene.cloud_pct,
                activity_score=result.activity_score,
                activity_centroid=centroid,
                ndvi_mean=result.ndvi_mean_after,
                ndbi_mean=result.ndbi_mean_after,
                rationale=(
                    f"trend={result.activity_trend:+.2f}; "
                    f"NDVI Δ={ndvi_delta:+.2f}; NDBI Δ={ndbi_delta:+.2f}"
                ),
            )
        )
        if result.activity_score > best_score:
            best_score = result.activity_score
            best_centroid = centroid
            best_ndvi_delta = ndvi_delta
            best_ndbi_delta = ndbi_delta
            best_pixel_change_pct = result.pixel_change_pct
    if not findings:
        return None
    return ProviderResult(
        provider=provider,
        activity_score=best_score,
        activity_centroid=best_centroid,
        findings=findings,
        ndvi_delta=best_ndvi_delta,
        ndbi_delta=best_ndbi_delta,
        pixel_change_pct=best_pixel_change_pct,
        cost_usd=cost,
    )


def _s1_pipeline(
    before: list[Scene],
    after: list[Scene],
    aoi: GeoBBox,
) -> ProviderResult | None:
    if not before or not after:
        return None
    before_scene = before[0]
    after_scene = after[-1]
    try:
        b_vv = read_s1_vv_backscatter(before_scene.bands["vv"], aoi)
        a_vv = read_s1_vv_backscatter(after_scene.bands["vv"], aoi)
    except VigilError as e:
        _logger.warning("s1-band-read-failed", error=str(e))
        return None
    score = s1_activity_score(b_vv, a_vv)
    finding = ActivityFinding(
        scene_id=after_scene.item_id,
        sensor=after_scene.sensor,
        captured_at=after_scene.captured_at,
        cloud_pct=0.0,
        activity_score=score,
        activity_centroid=None,
        ndvi_mean=None,
        ndbi_mean=None,
        rationale=(
            f"Sentinel-1 VV backscatter delta proxy — |Δσ°|/σ°(before) ≈ {score:.2f}"  # noqa: RUF001 — sigma is the SAR backscatter symbol, not a Latin o
        ),
    )
    return ProviderResult(
        provider="sentinel-1",
        activity_score=score,
        activity_centroid=None,
        findings=[finding],
        ndvi_delta=None,
        ndbi_delta=None,
        pixel_change_pct=None,
        cost_usd=0.0,
    )


def _pixel_to_lonlat(
    pixel: tuple[int, int] | None,
    aoi: GeoBBox,
    shape: tuple[int, ...],
) -> GeoPoint | None:
    if pixel is None or len(shape) != 2:
        return None
    h, w = cast(tuple[int, int], shape)
    py, px = pixel
    lon = aoi.min_lon + (px + 0.5) / max(w, 1) * (aoi.max_lon - aoi.min_lon)
    lat = aoi.max_lat - (py + 0.5) / max(h, 1) * (aoi.max_lat - aoi.min_lat)
    return GeoPoint(lat=lat, lon=lon)


async def _async_main() -> None:
    settings = Settings(worker_name="worker-satellite", otel_service_name="worker-satellite")
    init_logging(service=settings.worker_name, level=settings.log_level)
    install_shutdown()

    health_task = await serve_health(service=settings.worker_name, port=settings.prometheus_port)
    register_shutdown("health-server", health_task.cancel)

    worker = SatelliteWorker(settings)
    register_shutdown("worker", worker.stop)
    _logger.info(
        "worker-satellite-ready",
        stream=worker.stream,
        started_at=datetime.now(tz=UTC).isoformat(),
    )
    await worker.run()


def main() -> None:
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(_async_main())


if __name__ == "__main__":
    main()
