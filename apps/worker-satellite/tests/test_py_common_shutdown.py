"""Tests for vigil_common.shutdown — register + callback ordering.

We exercise the public registration API and `_run_callbacks` directly,
without installing real signal handlers (which would interfere with pytest).
"""

from __future__ import annotations

import asyncio

import pytest

import vigil_common.shutdown as sd
from vigil_common.logging import get_logger
from vigil_common.shutdown import _run_callbacks, register_shutdown


@pytest.fixture(autouse=True)
def _reset_callbacks() -> None:
    """Each test starts with a clean callback list."""
    sd._callbacks.clear()
    sd._shutting = False
    yield
    sd._callbacks.clear()
    sd._shutting = False


def test_register_shutdown_appends_callback() -> None:
    def cb() -> None:
        pass

    register_shutdown("svc-a", cb)
    assert sd._callbacks == [("svc-a", cb)]


def test_run_callbacks_invokes_in_reverse_order() -> None:
    order: list[str] = []

    def cb_a() -> None:
        order.append("a")

    def cb_b() -> None:
        order.append("b")

    def cb_c() -> None:
        order.append("c")

    register_shutdown("a", cb_a)
    register_shutdown("b", cb_b)
    register_shutdown("c", cb_c)

    log = get_logger("shutdown-test")
    with pytest.raises(SystemExit) as exc:
        asyncio.run(_run_callbacks(2.0, log))
    assert exc.value.code == 0
    # Reverse-registration order
    assert order == ["c", "b", "a"]


def test_run_callbacks_supports_coroutines() -> None:
    order: list[str] = []

    async def acb() -> None:
        order.append("async-x")

    def scb() -> None:
        order.append("sync-y")

    register_shutdown("sync", scb)
    register_shutdown("async", acb)
    log = get_logger("shutdown-test")
    with pytest.raises(SystemExit):
        asyncio.run(_run_callbacks(2.0, log))
    # reverse-registration: async first, then sync
    assert order == ["async-x", "sync-y"]


def test_run_callbacks_swallows_failures_and_continues() -> None:
    order: list[str] = []

    def cb_ok() -> None:
        order.append("ok")

    def cb_bad() -> None:
        raise RuntimeError("simulated")

    register_shutdown("first-ok", cb_ok)
    register_shutdown("then-bad", cb_bad)
    log = get_logger("shutdown-test")
    with pytest.raises(SystemExit):
        asyncio.run(_run_callbacks(2.0, log))
    # cb_bad fails; cb_ok still runs (ran second because reverse order)
    assert "ok" in order


def test_run_callbacks_honours_hard_timeout() -> None:
    """A callback that exceeds hard_timeout_s aborts and logs."""

    async def slow_cb() -> None:
        await asyncio.sleep(2.0)

    register_shutdown("slow", slow_cb)
    log = get_logger("shutdown-test")
    with pytest.raises(SystemExit) as exc:
        asyncio.run(_run_callbacks(0.05, log))
    # Even on timeout, _run_callbacks exits cleanly with code 0
    assert exc.value.code == 0
