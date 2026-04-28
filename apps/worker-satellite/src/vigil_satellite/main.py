"""worker-satellite entry point.

Consumes from `vigil:satellite:request`, runs the STAC fetch + activity
computation, and emits a `satellite_imagery` event onto `vigil:adapter:out`
so the existing pattern pipeline (P-D-001..P-D-005) picks it up.
"""

from __future__ import annotations

import asyncio
import json
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

from .activity import ActivityResult, compute_activity
from .schemas import (
    ActivityFinding,
    GeoBBox,
    GeoPoint,
    SatelliteEventPayload,
    SatelliteRequest,
)
from .stac import bbox_around, read_band, search_scenes

_logger = get_logger("worker-satellite")


class SatelliteWorker(RedisStreamWorker[SatelliteRequest]):
    name = "worker-satellite"
    stream = "vigil:satellite:request"
    schema = SatelliteRequest
    concurrency = 2  # Heavy I/O + numpy → keep small
    max_retries = 4

    def __init__(self, settings: Settings) -> None:
        super().__init__(
            redis_host=settings.redis_host,
            redis_port=settings.redis_port,
            redis_password_file=str(settings.redis_password_file),
            redis_db=settings.redis_db,
        )
        self._settings = settings

    async def handle(self, env: Envelope[SatelliteRequest]) -> HandlerOutcome:
        req = env.payload
        try:
            aoi = req.bbox or (
                bbox_around(req.centroid, req.buffer_m) if req.centroid else None
            )
            if aoi is None:
                return DeadLetter(reason="neither bbox nor centroid supplied")

            mid = req.contract_start + (req.contract_end - req.contract_start) * 0.10
            late = req.contract_start + (req.contract_end - req.contract_start) * 0.95

            before_scenes = search_scenes(
                catalog_url=self._settings.stac_catalog_url, aoi=aoi, when=mid,
                sensors=tuple(req.sensor_priority),
            )
            after_scenes = search_scenes(
                catalog_url=self._settings.stac_catalog_url, aoi=aoi, when=late,
                sensors=tuple(req.sensor_priority),
            )

            findings: list[ActivityFinding] = []
            best: ActivityResult | None = None
            for after in after_scenes[:3]:
                # Pair with the closest-cloud before-scene of the same sensor
                same = [s for s in before_scenes if s.sensor == after.sensor]
                if not same:
                    continue
                before = same[0]
                try:
                    b_red = read_band(before.bands["red"], aoi)
                    b_nir = read_band(before.bands["nir"], aoi)
                    b_swir = read_band(before.bands["swir"], aoi)
                    a_red = read_band(after.bands["red"], aoi)
                    a_nir = read_band(after.bands["nir"], aoi)
                    a_swir = read_band(after.bands["swir"], aoi)
                except VigilError as e:
                    _logger.warning("band-read-failed", scene_id=after.item_id, error=str(e))
                    continue

                result = compute_activity(
                    before_red=b_red, before_nir=b_nir, before_swir=b_swir,
                    after_red=a_red, after_nir=a_nir, after_swir=a_swir,
                )
                centroid = _pixel_to_lonlat(result.centroid_pixel, aoi, b_red.shape)
                findings.append(
                    ActivityFinding(
                        scene_id=after.item_id,
                        sensor=after.sensor,
                        captured_at=after.captured_at,
                        cloud_pct=after.cloud_pct,
                        activity_score=result.activity_score,
                        activity_centroid=centroid,
                        ndvi_mean=result.ndvi_mean_after,
                        ndbi_mean=result.ndbi_mean_after,
                        rationale=(
                            f"trend={result.activity_trend:+.2f}; "
                            f"NDVI Δ={result.ndvi_mean_after - result.ndvi_mean_before:+.2f}; "
                            f"NDBI Δ={result.ndbi_mean_after - result.ndbi_mean_before:+.2f}"
                        ),
                    )
                )
                if best is None or result.activity_score > best.activity_score:
                    best = result
                satellite_scenes_processed.labels(source=after.sensor, outcome="ok").inc()

            if not findings or best is None:
                satellite_scenes_processed.labels(source="any", outcome="no_pairs").inc()
                return Retry(reason="no usable before/after pairs", delay_ms=15 * 60_000)

            payload = SatelliteEventPayload(
                project_id=req.project_id,
                finding_id=req.finding_id,
                contract_window={
                    "start": req.contract_start,
                    "end": req.contract_end,
                },
                aoi_geojson=_aoi_geojson(aoi),
                n_scenes=len(findings),
                activity_score=best.activity_score,
                activity_trend=best.activity_trend,
                activity_centroid=findings[0].activity_centroid,
                findings=findings,
            )

            # Emit downstream event: kind=satellite_imagery
            outbound = self.envelope_dict(
                producer=self.name,
                payload={
                    "kind": "satellite_imagery",
                    "source_id": "worker-satellite",
                    "subject_kind": "Project",
                    "project_id": req.project_id,
                    "finding_id": req.finding_id,
                    "data": payload.model_dump(mode="json"),
                    "activity_score": best.activity_score,
                    "activity_centroid": (
                        findings[0].activity_centroid.model_dump()
                        if findings[0].activity_centroid
                        else None
                    ),
                },
                dedup_key=f"sat:{req.project_id}:{int(req.contract_start.timestamp())}",
                correlation_id=env.correlation_id,
            )
            await self.publish("vigil:adapter:out", outbound)

            _logger.info(
                "satellite-assessment-emitted",
                project_id=req.project_id,
                activity_score=best.activity_score,
                n_scenes=len(findings),
            )
            return Ack()
        except APIError as e:
            return Retry(reason=f"STAC API error: {e}", delay_ms=10 * 60_000)
        except VigilError as ve:
            if ve.retryable:
                return Retry(reason=ve.message, delay_ms=15 * 60_000)
            return DeadLetter(reason=ve.message)


def _aoi_geojson(aoi: GeoBBox) -> dict[str, object]:
    return {
        "type": "Polygon",
        "coordinates": [[
            [aoi.min_lon, aoi.min_lat],
            [aoi.max_lon, aoi.min_lat],
            [aoi.max_lon, aoi.max_lat],
            [aoi.min_lon, aoi.max_lat],
            [aoi.min_lon, aoi.min_lat],
        ]],
    }


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
    try:
        asyncio.run(_async_main())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
