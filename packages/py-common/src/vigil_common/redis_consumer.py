"""Redis Streams idempotent-consumer worker base.

Mirrors `@vigil/queue` (`WorkerBase`). Same envelope, same DB-commit-then-emit
semantics, same XAUTOCLAIM crash recovery. Implementations override
:meth:`handle` and call :meth:`run`.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import socket
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, TypeVar

import redis.asyncio as aioredis
from pydantic import BaseModel

from .errors import VigilError, asVigilError
from .logging import bind_correlation, get_logger, reset_correlation
from .metrics import (
    dedup_hits,
    errors_total,
    events_consumed,
    events_emitted,
    processing_duration,
    worker_inflight,
)
from .secrets import expose, read_secret_file

PayloadT = TypeVar("PayloadT", bound=BaseModel)


@dataclass(frozen=True)
class Envelope[PayloadT: BaseModel]:
    """Same shape as TypeScript `Envelope<T>` (queue/types.ts)."""

    id: str
    dedup_key: str
    correlation_id: str
    producer: str
    produced_at: str  # ISO instant
    schema_version: int
    payload: PayloadT


@dataclass(frozen=True)
class Ack:
    kind: Literal["ack"] = "ack"


@dataclass(frozen=True)
class Retry:
    reason: str
    delay_ms: int = 0
    kind: Literal["retry"] = "retry"


@dataclass(frozen=True)
class DeadLetter:
    reason: str
    kind: Literal["dead-letter"] = "dead-letter"


HandlerOutcome = Ack | Retry | DeadLetter


class RedisStreamWorker[PayloadT: BaseModel](ABC):
    """Subclass and implement :meth:`handle`. Call :meth:`run` to start."""

    name: str
    stream: str
    schema: type[PayloadT]
    schema_version: int = 1
    concurrency: int = 4
    max_retries: int = 5
    block_ms: int = 5_000
    idle_reclaim_ms: int = 300_000
    DEAD_LETTER_STREAM: str = "vigil:dead-letter"

    def __init__(
        self,
        *,
        redis_host: str,
        redis_port: int,
        redis_password_file: str | None = None,
        redis_db: int = 0,
    ) -> None:
        self._logger = get_logger(self.name)
        self._instance_id = f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:6]}"
        self._consumer_name = f"{self.name}-{self._instance_id}"
        self._group = f"cg:{self.name}"
        password = expose(read_secret_file(redis_password_file)) if redis_password_file else None
        self._redis: aioredis.Redis = aioredis.Redis(
            host=redis_host,
            port=redis_port,
            password=password,
            db=redis_db,
            decode_responses=True,
            socket_keepalive=True,
            health_check_interval=30,
        )
        self._running = False
        self._stopping = False
        self._inflight = 0
        # Hold strong refs to in-flight handler tasks so the event loop can't
        # garbage-collect them mid-execution (per RUF006 / Python asyncio docs).
        self._tasks: set[asyncio.Task[None]] = set()

    @abstractmethod
    async def handle(self, env: Envelope[PayloadT]) -> HandlerOutcome:
        """Process one envelope. MUST be idempotent at envelope.dedup_key."""

    async def run(self) -> None:
        """Run consumer loops until stopped."""
        await self._ensure_group()
        self._running = True
        self._logger.info(
            "worker-started",
            stream=self.stream,
            group=self._group,
            instance=self._instance_id,
        )
        await asyncio.gather(self._loop_xreadgroup(), self._loop_reclaim())

    async def stop(self) -> None:
        self._stopping = True
        for _ in range(60):
            if self._inflight == 0:
                break
            await asyncio.sleep(0.1)
        self._running = False
        with contextlib.suppress(Exception):
            await self._redis.aclose()
        self._logger.info("worker-stopped")

    async def publish(self, stream: str, envelope: dict[str, Any]) -> str:
        body = json.dumps(envelope, separators=(",", ":"), default=_json_default)
        msg_id = await self._redis.xadd(stream, {"body": body})
        events_emitted.labels(worker=self.name, stream=stream).inc()
        return msg_id  # type: ignore[no-any-return]

    @staticmethod
    def envelope_dict(
        *,
        producer: str,
        payload: dict[str, Any],
        dedup_key: str,
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        return {
            "id": str(uuid.uuid4()),
            "dedup_key": dedup_key,
            "correlation_id": correlation_id or str(uuid.uuid4()),
            "producer": producer,
            "produced_at": datetime.now(tz=UTC).isoformat(),
            "schema_version": 1,
            "payload": payload,
        }

    # -- internals -------------------------------------------------------------

    async def _ensure_group(self) -> None:
        try:
            await self._redis.xgroup_create(self.stream, self._group, id="$", mkstream=True)
            self._logger.info("consumer-group-created", stream=self.stream, group=self._group)
        except Exception as e:
            if "BUSYGROUP" not in str(e):
                raise

    async def _loop_xreadgroup(self) -> None:
        while self._running and not self._stopping:
            try:
                slots = max(0, self.concurrency - self._inflight)
                if slots == 0:
                    await asyncio.sleep(0.05)
                    continue
                msgs = await self._redis.xreadgroup(
                    groupname=self._group,
                    consumername=self._consumer_name,
                    streams={self.stream: ">"},
                    count=slots,
                    block=self.block_ms,
                )
                if not msgs:
                    continue
                for _stream_name, entries in msgs:
                    for msg_id, fields in entries:
                        body = fields.get("body", "{}")
                        # Fire and forget — bounded by `concurrency`; strong-ref
                        # via self._tasks to prevent GC-mid-flight.
                        task = asyncio.create_task(self._process(msg_id, body))
                        self._tasks.add(task)
                        task.add_done_callback(self._tasks.discard)
            except Exception as e:
                self._logger.exception("read-group-error", error=str(e))
                await asyncio.sleep(1)

    async def _loop_reclaim(self) -> None:
        while self._running and not self._stopping:
            try:
                # XAUTOCLAIM: take over messages idle > idle_reclaim_ms from dead consumers
                cursor = "0"
                while True:
                    res = await self._redis.xautoclaim(
                        name=self.stream,
                        groupname=self._group,
                        consumername=self._consumer_name,
                        min_idle_time=self.idle_reclaim_ms,
                        start_id=cursor,
                        count=10,
                    )
                    next_cursor = res[0]
                    claimed = res[1]
                    for msg_id, fields in claimed:
                        body = fields.get("body", "{}")
                        self._logger.warning("reclaimed-stale-message", id=msg_id)
                        task = asyncio.create_task(self._process(msg_id, body))
                        self._tasks.add(task)
                        task.add_done_callback(self._tasks.discard)
                    if next_cursor in {"0-0", b"0-0", "0", b"0"}:
                        break
                    cursor = next_cursor if isinstance(next_cursor, str) else next_cursor.decode()
            except Exception as e:
                self._logger.exception("autoclaim-error", error=str(e))
            await asyncio.sleep(self.idle_reclaim_ms / 1000)

    async def _process(self, msg_id: str, body: str) -> None:
        self._inflight += 1
        worker_inflight.labels(worker=self.name).set(self._inflight)
        events_consumed.labels(worker=self.name, stream=self.stream).inc()

        token = None
        try:
            try:
                raw = json.loads(body)
                payload_obj = self.schema.model_validate(raw["payload"])
                envelope: Envelope[PayloadT] = Envelope(
                    id=str(raw["id"]),
                    dedup_key=str(raw["dedup_key"]),
                    correlation_id=str(raw["correlation_id"]),
                    producer=str(raw["producer"]),
                    produced_at=str(raw["produced_at"]),
                    schema_version=int(raw["schema_version"]),
                    payload=payload_obj,
                )
            except Exception as e:
                errors_total.labels(service=self.name, code="PARSE", severity="error").inc()
                self._logger.exception("envelope-parse-failed", error=str(e), msg_id=msg_id)
                await self._dead_letter(msg_id, body, "envelope-parse-failed")
                return

            # Idempotency at dedup_key (24h)
            dedup_key = f"vigil:dedup:{self.name}:{envelope.dedup_key}"
            set_ok = await self._redis.set(dedup_key, "1", nx=True, ex=86_400)
            if set_ok is None:
                dedup_hits.labels(worker=self.name).inc()
                await self._redis.xack(self.stream, self._group, msg_id)
                return

            token = bind_correlation(envelope.correlation_id)
            with processing_duration.labels(worker=self.name, kind=self.stream).time():
                outcome = await self.handle(envelope)

            if outcome.kind == "ack":
                await self._redis.xack(self.stream, self._group, msg_id)
            elif outcome.kind == "retry":
                self._logger.warning("handler-retry", reason=outcome.reason, msg_id=msg_id)
                if outcome.delay_ms > 0:
                    await asyncio.sleep(outcome.delay_ms / 1000)
                # Release dedup lock so retry can re-enter
                await self._redis.delete(dedup_key)
            elif outcome.kind == "dead-letter":
                self._logger.error("handler-dead-letter", reason=outcome.reason, msg_id=msg_id)
                await self._dead_letter(msg_id, body, outcome.reason)
                await self._redis.xack(self.stream, self._group, msg_id)
        except VigilError as ve:
            errors_total.labels(service=self.name, code=ve.code, severity=ve.severity).inc()
            self._logger.exception("handler-vigil-error", **ve.to_dict(), msg_id=msg_id)
            await self._dead_letter(msg_id, body, str(ve))
            await self._redis.xack(self.stream, self._group, msg_id)
        except Exception as e:
            ve = asVigilError(e)
            errors_total.labels(service=self.name, code=ve.code, severity=ve.severity).inc()
            self._logger.exception("handler-threw", error=str(e), msg_id=msg_id)
            await self._dead_letter(msg_id, body, str(e))
            await self._redis.xack(self.stream, self._group, msg_id)
        finally:
            self._inflight -= 1
            worker_inflight.labels(worker=self.name).set(self._inflight)
            if token is not None:
                reset_correlation(token)

    async def _dead_letter(self, msg_id: str, body: str, reason: str) -> None:
        dl_envelope = self.envelope_dict(
            producer=self.name,
            payload={
                "original_stream": self.stream,
                "original_redis_id": msg_id,
                "original_body": body,
                "reason": reason,
                "worker": self.name,
            },
            dedup_key=f"dlq:{self.name}:{msg_id}",
        )
        await self.publish(self.DEAD_LETTER_STREAM, dl_envelope)


def _json_default(o: Any) -> Any:  # noqa: ANN401 — json.dumps `default=` callback signature is fixed by stdlib
    if isinstance(o, datetime):
        return o.isoformat()
    if isinstance(o, BaseModel):
        return o.model_dump()
    raise TypeError(f"Cannot serialize {type(o).__name__}")
