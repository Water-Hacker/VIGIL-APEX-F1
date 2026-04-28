"""worker-image-forensics entry point.

Consumes from `vigil:document:fetch:image`. For each image:
  1. Fetch from IPFS by CID (read-only via vigil-ipfs gateway).
  2. Strip EXIF; pin sanitised copy back to IPFS.
  3. If the document is a contract amendment / completion certificate and a
     reference signature CID is supplied, run signature similarity.
  4. If a critical-field bounding box is supplied, run font-anomaly detection.
  5. Emit a `document_forensics` event onto `vigil:adapter:out` so the existing
     pattern pipeline (P-G-002, P-G-004) picks it up.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import cv2
import httpx
import numpy as np

from vigil_common.config import Settings
from vigil_common.errors import VigilError
from vigil_common.health import serve_health
from vigil_common.logging import get_logger, init_logging
from vigil_common.metrics import forensics_documents_processed
from vigil_common.redis_consumer import (
    Ack,
    DeadLetter,
    Envelope,
    HandlerOutcome,
    RedisStreamWorker,
    Retry,
)
from vigil_common.shutdown import install_shutdown, register_shutdown

from .exif import strip_exif
from .fonts import detect_font_anomaly
from .schemas import ForensicsRequest, ForensicsResult
from .signatures import compare_signatures

_logger = get_logger("worker-image-forensics")


class ForensicsWorker(RedisStreamWorker[ForensicsRequest]):
    name = "worker-image-forensics"
    stream = "vigil:document:fetch:image"
    schema = ForensicsRequest
    concurrency = 4

    def __init__(self, settings: Settings) -> None:
        super().__init__(
            redis_host=settings.redis_host,
            redis_port=settings.redis_port,
            redis_password_file=str(settings.redis_password_file),
            redis_db=settings.redis_db,
        )
        self._settings = settings
        self._http: httpx.AsyncClient | None = None

    async def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=30.0)
        return self._http

    async def _fetch_cid(self, cid: str) -> bytes:
        client = await self._client()
        url = f"{self._settings.ipfs_api_url.rstrip('/')}/api/v0/cat?arg={cid}"
        resp = await client.post(url)
        if resp.status_code >= 400:
            raise VigilError(
                code="IPFS_FETCH_FAILED",
                message=f"IPFS fetch {cid} returned {resp.status_code}",
                severity="warn",
                retryable=True,
            )
        return resp.content

    async def _pin_bytes(self, content: bytes, name_hint: str) -> str:
        client = await self._client()
        url = f"{self._settings.ipfs_api_url.rstrip('/')}/api/v0/add?pin=true&cid-version=1"
        files = {"file": (name_hint, content)}
        resp = await client.post(url, files=files)
        if resp.status_code >= 400:
            raise VigilError(
                code="IPFS_PIN_FAILED",
                message=f"IPFS pin failed: {resp.status_code}",
                severity="error",
                retryable=True,
            )
        body = resp.json()
        cid = str(body.get("Hash") or body.get("cid"))
        return cid

    async def handle(self, env: Envelope[ForensicsRequest]) -> HandlerOutcome:
        req = env.payload
        try:
            raw = await self._fetch_cid(req.document_cid)
            sanitised, exif_report = strip_exif(raw)
            sanitised_cid = await self._pin_bytes(sanitised, name_hint=f"{req.document_cid}.clean")

            sig = None
            if req.reference_signature_cid:
                try:
                    ref = await self._fetch_cid(req.reference_signature_cid)
                    sig = compare_signatures(reference_bytes=ref, candidate_bytes=raw)
                except VigilError as e:
                    _logger.warning("signature-compare-failed", error=str(e))

            font = None
            if req.bbox:
                try:
                    page = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
                    if page is None:
                        raise VigilError(
                            code="FORENSICS_DECODE_FAILED",
                            message="cannot decode page image",
                            severity="warn",
                        )
                    h, w = page.shape[:2]
                    x0, y0, x1, y1 = req.bbox
                    bbox_px = (
                        int(round(x0 * w)),
                        int(round(y0 * h)),
                        int(round((x1 - x0) * w)),
                        int(round((y1 - y0) * h)),
                    )
                    font = detect_font_anomaly(page, bbox_px, field_label="other")
                except VigilError as e:
                    _logger.warning("font-detect-failed", error=str(e))

            result = ForensicsResult(
                document_cid=req.document_cid,
                finding_id=req.finding_id,
                signature_similarity_score=sig.score if sig else None,
                font_anomaly_score=font.score if font else None,
                signature=sig,
                font=font,
                exif=exif_report,
                sanitised_cid=sanitised_cid,
            )

            outbound = self.envelope_dict(
                producer=self.name,
                payload={
                    "kind": "audit_observation",
                    "source_id": "worker-image-forensics",
                    "subject_kind": "Tender",
                    "document_cid": req.document_cid,
                    "finding_id": req.finding_id,
                    "data": result.model_dump(mode="json"),
                    # Surface scores at the top level for pattern detection convenience
                    "signature_similarity_score": sig.score if sig else None,
                    "font_anomaly_score": font.score if font else None,
                },
                dedup_key=f"forensics:{req.document_cid}:{req.page}",
                correlation_id=env.correlation_id,
            )
            await self.publish("vigil:adapter:out", outbound)

            forensics_documents_processed.labels(kind=req.document_kind, outcome="ok").inc()
            _logger.info(
                "forensics-emitted",
                document_cid=req.document_cid,
                signature_score=sig.score if sig else None,
                font_score=font.score if font else None,
            )
            return Ack()
        except VigilError as ve:
            forensics_documents_processed.labels(
                kind=req.document_kind, outcome="error",
            ).inc()
            if ve.retryable:
                return Retry(reason=ve.message, delay_ms=2 * 60_000)
            return DeadLetter(reason=ve.message)


async def _async_main() -> None:
    settings = Settings(
        worker_name="worker-image-forensics",
        otel_service_name="worker-image-forensics",
    )
    init_logging(service=settings.worker_name, level=settings.log_level)
    install_shutdown()

    health_task = await serve_health(service=settings.worker_name, port=settings.prometheus_port)
    register_shutdown("health-server", health_task.cancel)

    worker = ForensicsWorker(settings)
    register_shutdown("worker", worker.stop)
    _logger.info(
        "worker-image-forensics-ready",
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
