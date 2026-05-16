"""Tests for vigil_common.pg — DSN construction + pool wrapper smoke."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from vigil_common.errors import VigilError
from vigil_common.pg import PgPool


def test_pgpool_construct_does_not_open_connection() -> None:
    """Constructor must build the pool with open=False (lazy)."""
    p = PgPool("host=x dbname=y user=z password=p", min_size=2, max_size=8)
    assert p is not None
    # _pool exists and is an AsyncConnectionPool (lazy — not opened)
    assert p._pool is not None


def test_pgpool_from_env_builds_dsn_from_secret(tmp_path: Path) -> None:
    pw_file = tmp_path / "pgpw"
    pw_file.write_text("super-pw", encoding="utf-8")

    with patch("vigil_common.pg.AsyncConnectionPool") as ctor:
        PgPool.from_env(
            host="db.example",
            port=5433,
            db="vigil_db",
            user="vu",
            password_file=str(pw_file),
            min_size=3,
            max_size=11,
            statement_timeout_ms=15_000,
            lock_timeout_ms=4_000,
        )
    ctor.assert_called_once()
    dsn = ctor.call_args.kwargs.get("conninfo") or ctor.call_args.args[0]
    assert "host=db.example" in dsn
    assert "port=5433" in dsn
    assert "dbname=vigil_db" in dsn
    assert "user=vu" in dsn
    assert "password=super-pw" in dsn
    assert "statement_timeout=15000" in dsn
    assert "lock_timeout=4000" in dsn


def test_pgpool_healthcheck_propagates_failure_as_vigil_error() -> None:
    p = PgPool("host=x")
    # Simulate a failing fetchone
    p.fetchone = AsyncMock(side_effect=RuntimeError("connection refused"))  # type: ignore[method-assign]

    with pytest.raises(VigilError) as exc:
        asyncio.run(p.healthcheck())
    assert exc.value.code == "PG_HEALTHCHECK_FAILED"


def test_pgpool_healthcheck_succeeds_when_fetchone_returns() -> None:
    p = PgPool("host=x")
    p.fetchone = AsyncMock(return_value=(1,))  # type: ignore[method-assign]
    asyncio.run(p.healthcheck())  # no exception
