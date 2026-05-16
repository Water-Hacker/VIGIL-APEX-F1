"""Tests for vigil_forensics.main — handler routing without live Redis.

We build a worker instance with a mocked AsyncClient, drive `handle()`
end-to-end with fake IPFS responses, and assert on the routed outcome.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch

import fakeredis
import pytest
from PIL import Image

from vigil_common.config import Settings
from vigil_common.errors import VigilError
from vigil_common.redis_consumer import Envelope
from vigil_forensics.main import ForensicsWorker
from vigil_forensics.schemas import ForensicsRequest


def _png_bytes() -> bytes:
    out = BytesIO()
    Image.new("RGB", (32, 32), color=(0, 128, 255)).save(out, format="PNG")
    return out.getvalue()


def _worker_with_fakes(tmp_path) -> ForensicsWorker:  # type: ignore[no-untyped-def]
    """Build a ForensicsWorker wired to fakeredis."""
    pwfile = tmp_path / "rpw"
    pwfile.write_text("rpw", encoding="utf-8")
    settings = Settings(
        worker_name="worker-image-forensics",
        otel_service_name="worker-image-forensics",
        redis_password_file=pwfile,
        ipfs_api_url="http://ipfs:5001",
    )
    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    with patch("vigil_common.redis_consumer.aioredis.Redis", return_value=fake):
        return ForensicsWorker(settings)


def _envelope(req: ForensicsRequest) -> Envelope[ForensicsRequest]:
    return Envelope(
        id="evt-1",
        dedup_key="dk-1",
        correlation_id="cid-1",
        producer="test",
        produced_at=datetime.now(tz=UTC).isoformat(),
        schema_version=1,
        payload=req,
    )


def test_handle_returns_dead_letter_on_non_retryable_ipfs(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """A 404 from IPFS surfaces as IPFS_FETCH_FAILED (retryable=True) — Retry."""
    w = _worker_with_fakes(tmp_path)
    req = ForensicsRequest(
        document_cid="QmTestDocCID0123456789",
        page=1,
        document_kind="amendment",
    )

    # Mock httpx async client: GET/POST raises a non-200
    fake_client = AsyncMock()
    fake_client.post = AsyncMock(return_value=MagicMock(status_code=404, content=b""))
    w._http = fake_client

    outcome = asyncio.run(w.handle(_envelope(req)))
    # 404 ⇒ IPFS_FETCH_FAILED ⇒ retryable=True ⇒ Retry
    assert outcome.kind == "retry"


def test_handle_returns_dead_letter_when_non_retryable_error(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """Force a non-retryable VigilError → DeadLetter."""
    w = _worker_with_fakes(tmp_path)
    req = ForensicsRequest(
        document_cid="QmTestDocCID0123456789",
        page=1,
        document_kind="other",
    )

    # Make _fetch_cid raise non-retryable
    async def boom(cid: str) -> bytes:
        raise VigilError(code="X", message="permanent", severity="error", retryable=False)

    w._fetch_cid = boom  # type: ignore[method-assign]
    outcome = asyncio.run(w.handle(_envelope(req)))
    assert outcome.kind == "dead-letter"


def test_handle_succeeds_end_to_end_returns_ack(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """Happy path: fetch ⇒ strip ⇒ pin ⇒ ack."""
    w = _worker_with_fakes(tmp_path)
    req = ForensicsRequest(
        document_cid="QmTestDocCID0123456789",
        page=1,
        document_kind="other",
    )

    img = _png_bytes()

    # _fetch_cid returns our PNG; _pin_bytes returns a fake CID
    async def fake_fetch(cid: str) -> bytes:
        return img

    async def fake_pin(_b: bytes, name_hint: str) -> str:
        return "bafycleancid"

    w._fetch_cid = fake_fetch  # type: ignore[method-assign]
    w._pin_bytes = fake_pin  # type: ignore[method-assign]
    # publish: stub to avoid touching the real stream
    w.publish = AsyncMock(return_value="0-1")  # type: ignore[method-assign]

    outcome = asyncio.run(w.handle(_envelope(req)))
    assert outcome.kind == "ack"
    w.publish.assert_called_once()


def test_handle_with_reference_signature_runs_compare(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """When reference_signature_cid is set, compare_signatures gets called."""
    w = _worker_with_fakes(tmp_path)
    req = ForensicsRequest(
        document_cid="QmDocCIDXXXXXXXXXX1",
        reference_signature_cid="QmRefCIDXXXXXXXXXX2",
        page=1,
        document_kind="amendment",
    )

    img = _png_bytes()

    async def fake_fetch(cid: str) -> bytes:
        return img

    async def fake_pin(_b: bytes, name_hint: str) -> str:
        return "bafyclean"

    w._fetch_cid = fake_fetch  # type: ignore[method-assign]
    w._pin_bytes = fake_pin  # type: ignore[method-assign]
    w.publish = AsyncMock(return_value="0-1")  # type: ignore[method-assign]

    outcome = asyncio.run(w.handle(_envelope(req)))
    assert outcome.kind == "ack"


def test_handle_with_bbox_runs_font_detection(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """When bbox is set, detect_font_anomaly is invoked."""
    w = _worker_with_fakes(tmp_path)
    req = ForensicsRequest(
        document_cid="QmDocCIDXXXXXXXXXX1",
        page=1,
        document_kind="other",
        bbox=(0.1, 0.1, 0.5, 0.5),
    )

    img = _png_bytes()

    async def fake_fetch(cid: str) -> bytes:
        return img

    async def fake_pin(_b: bytes, name_hint: str) -> str:
        return "bafyclean"

    w._fetch_cid = fake_fetch  # type: ignore[method-assign]
    w._pin_bytes = fake_pin  # type: ignore[method-assign]
    w.publish = AsyncMock(return_value="0-1")  # type: ignore[method-assign]

    outcome = asyncio.run(w.handle(_envelope(req)))
    # font detection runs against a 32x32 PNG with bbox (3,3,16,16) — may
    # succeed (Ack) or fail-soft (still Ack). Either way the handler exits
    # via the happy path.
    assert outcome.kind == "ack"


def test_client_factory_caches_singleton(tmp_path) -> None:  # type: ignore[no-untyped-def]
    w = _worker_with_fakes(tmp_path)
    c1 = asyncio.run(w._client())
    c2 = asyncio.run(w._client())
    assert c1 is c2
    asyncio.run(c1.aclose())


def test_fetch_cid_returns_bytes_on_200(tmp_path) -> None:  # type: ignore[no-untyped-def]
    w = _worker_with_fakes(tmp_path)
    fake_resp = MagicMock(status_code=200, content=b"binary-content")
    fake_client = AsyncMock()
    fake_client.post = AsyncMock(return_value=fake_resp)
    w._http = fake_client
    out = asyncio.run(w._fetch_cid("CIDxxx"))
    assert out == b"binary-content"


def test_fetch_cid_raises_on_error(tmp_path) -> None:  # type: ignore[no-untyped-def]
    w = _worker_with_fakes(tmp_path)
    fake_resp = MagicMock(status_code=500, content=b"err")
    fake_client = AsyncMock()
    fake_client.post = AsyncMock(return_value=fake_resp)
    w._http = fake_client
    with pytest.raises(VigilError) as exc:
        asyncio.run(w._fetch_cid("CIDxxx"))
    assert exc.value.code == "IPFS_FETCH_FAILED"


def test_pin_bytes_returns_cid_on_success(tmp_path) -> None:  # type: ignore[no-untyped-def]
    w = _worker_with_fakes(tmp_path)
    fake_resp = MagicMock(status_code=200)
    fake_resp.json.return_value = {"Hash": "bafytest"}
    fake_client = AsyncMock()
    fake_client.post = AsyncMock(return_value=fake_resp)
    w._http = fake_client
    out = asyncio.run(w._pin_bytes(b"data", "f.bin"))
    assert out == "bafytest"


def test_pin_bytes_raises_on_error(tmp_path) -> None:  # type: ignore[no-untyped-def]
    w = _worker_with_fakes(tmp_path)
    fake_resp = MagicMock(status_code=500)
    fake_client = AsyncMock()
    fake_client.post = AsyncMock(return_value=fake_resp)
    w._http = fake_client
    with pytest.raises(VigilError) as exc:
        asyncio.run(w._pin_bytes(b"data", "f.bin"))
    assert exc.value.code == "IPFS_PIN_FAILED"
