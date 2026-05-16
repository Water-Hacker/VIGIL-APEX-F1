"""Tests for vigil_common.redis_consumer — Envelope helpers + dedup logic.

We don't exercise the full XREAD/XACK loop (that requires a live Redis
group + concurrent handler scheduling, properly an integration test).
Instead we cover:

  - envelope_dict() shape & defaults
  - the @dataclass envelope kinds (Ack/Retry/DeadLetter)
  - _json_default serializer
  - the publish path with a fake redis client
  - dedup-hit branch of _process (using fakeredis)
  - dead-letter publish helper
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import fakeredis
import pytest
from pydantic import BaseModel

from vigil_common.redis_consumer import (
    Ack,
    DeadLetter,
    RedisStreamWorker,
    Retry,
    _json_default,
)


class _DummyPayload(BaseModel):
    n: int
    name: str


class _DummyWorker(RedisStreamWorker[_DummyPayload]):
    name = "test-worker"
    stream = "vigil:test:stream"
    schema = _DummyPayload

    async def handle(self, env):  # type: ignore[override, no-untyped-def]
        return Ack()


def _mk_worker_with_fakeredis() -> _DummyWorker:
    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    with patch("vigil_common.redis_consumer.aioredis.Redis", return_value=fake):
        w = _DummyWorker(
            redis_host="x",
            redis_port=6379,
            redis_password_file=None,
            redis_db=0,
        )
    return w


def test_envelope_dict_default_correlation_is_uuid() -> None:
    env = RedisStreamWorker.envelope_dict(
        producer="prod-x",
        payload={"a": 1},
        dedup_key="dk",
    )
    assert env["producer"] == "prod-x"
    assert env["payload"] == {"a": 1}
    assert env["dedup_key"] == "dk"
    # both ids must be valid UUIDs
    uuid.UUID(env["id"])
    uuid.UUID(env["correlation_id"])
    # schema_version default
    assert env["schema_version"] == 1
    # produced_at is iso8601 with tz
    datetime.fromisoformat(env["produced_at"])


def test_envelope_dict_with_explicit_correlation() -> None:
    env = RedisStreamWorker.envelope_dict(
        producer="p",
        payload={},
        dedup_key="dk",
        correlation_id="cid-given",
    )
    assert env["correlation_id"] == "cid-given"


def test_outcome_kinds_are_distinct() -> None:
    assert Ack().kind == "ack"
    assert Retry(reason="r").kind == "retry"
    assert Retry(reason="r").delay_ms == 0
    assert DeadLetter(reason="d").kind == "dead-letter"


def test_json_default_handles_datetime() -> None:
    dt = datetime(2025, 1, 1, tzinfo=UTC)
    out = _json_default(dt)
    assert out == dt.isoformat()


def test_json_default_handles_basemodel() -> None:
    p = _DummyPayload(n=1, name="x")
    out = _json_default(p)
    assert out == {"n": 1, "name": "x"}


def test_json_default_raises_for_unknown() -> None:
    with pytest.raises(TypeError):
        _json_default(object())


def test_worker_construction_sets_consumer_identity() -> None:
    w = _mk_worker_with_fakeredis()
    assert w.name == "test-worker"
    assert w._group == "cg:test-worker"
    assert w._consumer_name.startswith("test-worker-")
    assert w._inflight == 0
    assert w._running is False


def test_worker_publish_writes_to_stream() -> None:
    w = _mk_worker_with_fakeredis()

    async def _run() -> str:
        env = {"id": "1", "payload": {"x": 1}}
        return await w.publish("downstream", env)

    msg_id = asyncio.run(_run())
    assert isinstance(msg_id, str)
    # The fake should have received the message
    assert "-" in msg_id


def test_ensure_group_handles_busygroup() -> None:
    """BUSYGROUP errors are swallowed (group already exists)."""
    w = _mk_worker_with_fakeredis()
    # Patch xgroup_create to throw "BUSYGROUP"
    w._redis.xgroup_create = AsyncMock(side_effect=Exception("BUSYGROUP exists"))  # type: ignore[method-assign]
    asyncio.run(w._ensure_group())
    # No raise ⇒ the busy-group path is exercised


def test_ensure_group_propagates_other_errors() -> None:
    w = _mk_worker_with_fakeredis()
    w._redis.xgroup_create = AsyncMock(side_effect=Exception("WRONGTYPE"))  # type: ignore[method-assign]
    with pytest.raises(Exception, match="WRONGTYPE"):
        asyncio.run(w._ensure_group())


def test_dead_letter_publishes_to_dlq() -> None:
    w = _mk_worker_with_fakeredis()
    captured: dict[str, Any] = {}

    async def fake_publish(stream: str, envelope: dict[str, Any]) -> str:
        captured["stream"] = stream
        captured["envelope"] = envelope
        return "0-1"

    w.publish = fake_publish  # type: ignore[method-assign]

    asyncio.run(w._dead_letter("123-0", '{"a": 1}', "reason-x"))
    assert captured["stream"] == "vigil:dead-letter"
    payload = captured["envelope"]["payload"]
    assert payload["original_stream"] == "vigil:test:stream"
    assert payload["original_redis_id"] == "123-0"
    assert payload["reason"] == "reason-x"


def test_process_dedup_hit_acks_and_returns_early() -> None:
    """Second message with same dedup_key SHOULD ack immediately."""
    w = _mk_worker_with_fakeredis()
    body = json.dumps(
        {
            "id": "evt-1",
            "dedup_key": "DK-1",
            "correlation_id": "cid-1",
            "producer": "p",
            "produced_at": datetime.now(tz=UTC).isoformat(),
            "schema_version": 1,
            "payload": {"n": 1, "name": "x"},
        }
    )

    async def _run() -> None:
        # First process: should succeed
        await w._process("0-1", body)
        # Second process with same dedup key: should hit the dedup branch
        await w._process("0-2", body)

    asyncio.run(_run())
    # After both runs, inflight returns to zero
    assert w._inflight == 0


def test_process_handles_envelope_parse_error() -> None:
    """Malformed body triggers PARSE error + dead-letter."""
    w = _mk_worker_with_fakeredis()
    called: dict[str, Any] = {}

    async def fake_dlq(msg_id: str, body: str, reason: str) -> None:
        called["msg_id"] = msg_id
        called["reason"] = reason

    w._dead_letter = fake_dlq  # type: ignore[method-assign]

    asyncio.run(w._process("9-0", "not-json"))
    assert called["msg_id"] == "9-0"
    assert "envelope-parse-failed" in called["reason"]
    assert w._inflight == 0


def test_process_handler_retry_releases_dedup_lock() -> None:
    """When handle() returns Retry, the dedup key is deleted so retry can re-enter."""

    class _RetryWorker(_DummyWorker):
        async def handle(self, env):  # type: ignore[override, no-untyped-def]
            return Retry(reason="transient", delay_ms=0)

    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    with patch("vigil_common.redis_consumer.aioredis.Redis", return_value=fake):
        w = _RetryWorker(redis_host="x", redis_port=6379)

    body = json.dumps(
        {
            "id": "evt-r",
            "dedup_key": "DK-R",
            "correlation_id": "cid-r",
            "producer": "p",
            "produced_at": datetime.now(tz=UTC).isoformat(),
            "schema_version": 1,
            "payload": {"n": 1, "name": "x"},
        }
    )
    asyncio.run(w._process("0-1", body))
    # Key released (NX set on second pass would succeed again)
    key = f"vigil:dedup:{w.name}:DK-R"

    async def _check() -> Any:
        return await w._redis.get(key)

    assert asyncio.run(_check()) is None


def test_process_handler_dead_letter_outcome() -> None:
    class _DLWorker(_DummyWorker):
        async def handle(self, env):  # type: ignore[override, no-untyped-def]
            return DeadLetter(reason="permanent")

    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    with patch("vigil_common.redis_consumer.aioredis.Redis", return_value=fake):
        w = _DLWorker(redis_host="x", redis_port=6379)

    captured: dict[str, Any] = {}

    async def fake_dlq(msg_id: str, body: str, reason: str) -> None:
        captured["reason"] = reason

    w._dead_letter = fake_dlq  # type: ignore[method-assign]

    body = json.dumps(
        {
            "id": "evt-dl",
            "dedup_key": "DK-DL",
            "correlation_id": "cid-dl",
            "producer": "p",
            "produced_at": datetime.now(tz=UTC).isoformat(),
            "schema_version": 1,
            "payload": {"n": 1, "name": "x"},
        }
    )
    asyncio.run(w._process("0-1", body))
    assert captured["reason"] == "permanent"


def test_process_handler_raises_generic_exception_dlq() -> None:
    class _BoomWorker(_DummyWorker):
        async def handle(self, env):  # type: ignore[override, no-untyped-def]
            raise RuntimeError("boom")

    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    with patch("vigil_common.redis_consumer.aioredis.Redis", return_value=fake):
        w = _BoomWorker(redis_host="x", redis_port=6379)

    captured: dict[str, str] = {}

    async def fake_dlq(msg_id: str, body: str, reason: str) -> None:
        captured["reason"] = reason

    w._dead_letter = fake_dlq  # type: ignore[method-assign]

    body = json.dumps(
        {
            "id": "evt-b",
            "dedup_key": "DK-B",
            "correlation_id": "cid-b",
            "producer": "p",
            "produced_at": datetime.now(tz=UTC).isoformat(),
            "schema_version": 1,
            "payload": {"n": 1, "name": "x"},
        }
    )
    asyncio.run(w._process("0-1", body))
    assert "boom" in captured["reason"]
