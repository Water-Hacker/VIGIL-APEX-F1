"""Graceful shutdown — registers SIGTERM/SIGINT handlers that fire callbacks
in reverse-registration order with a hard timeout ceiling."""

from __future__ import annotations

import asyncio
import signal
from collections.abc import Awaitable, Callable

import structlog

from .logging import get_logger

type ShutdownCallback = Callable[[], Awaitable[None] | None]

_callbacks: list[tuple[str, ShutdownCallback]] = []
_installed = False
_shutting = False
# Strong refs to graceful-shutdown background tasks (per RUF006).
_shutdown_tasks: set[asyncio.Task[None]] = set()


def register_shutdown(name: str, cb: ShutdownCallback) -> None:
    _callbacks.append((name, cb))


def install_shutdown(*, hard_timeout_s: float = 30.0) -> None:
    """Install signal handlers once. Idempotent."""
    global _installed  # noqa: PLW0603
    if _installed:
        return
    _installed = True

    log = get_logger("vigil-common.shutdown")
    loop = asyncio.get_event_loop()

    def _handler(signum: int) -> None:
        global _shutting  # noqa: PLW0603
        if _shutting:
            log.warning("second-signal-during-shutdown; forcing exit")
            raise SystemExit(1)
        _shutting = True
        log.info("graceful-shutdown-start", signal=signal.Signals(signum).name)
        task = loop.create_task(_run_callbacks(hard_timeout_s, log))
        _shutdown_tasks.add(task)
        task.add_done_callback(_shutdown_tasks.discard)

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, _handler, sig)


async def _run_callbacks(hard_timeout_s: float, log: structlog.stdlib.BoundLogger) -> None:
    try:
        async with asyncio.timeout(hard_timeout_s):
            for name, cb in reversed(_callbacks):
                try:
                    res = cb()
                    if asyncio.iscoroutine(res):
                        await res
                    log.info("shutdown-callback-ok", name=name)
                except Exception as e:
                    log.exception("shutdown-callback-failed", name=name, error=str(e))
    except TimeoutError:
        log.exception("graceful-shutdown-hard-timeout", hard_timeout_s=hard_timeout_s)
    log.info("graceful-shutdown-complete")
    raise SystemExit(0)
