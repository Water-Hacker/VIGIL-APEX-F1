"""Async-friendly Postgres pool wrapper around psycopg 3.

Workers use :class:`PgPool` for connection-pooled execution. The pool is
configured for the same statement / lock / idle-tx timeouts as the TS-side
client.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Final

import psycopg
from psycopg_pool import AsyncConnectionPool

from .errors import VigilError
from .secrets import expose, read_secret_file


class PgPool:
    """Lightweight wrapper around psycopg_pool.AsyncConnectionPool."""

    def __init__(self, dsn: str, *, min_size: int = 1, max_size: int = 10) -> None:
        self._pool: Final = AsyncConnectionPool(
            conninfo=dsn,
            min_size=min_size,
            max_size=max_size,
            open=False,
            kwargs={"autocommit": False, "application_name": "vigil-py-worker"},
        )

    @classmethod
    def from_env(
        cls,
        *,
        host: str,
        port: int,
        db: str,
        user: str,
        password_file: str,
        min_size: int = 1,
        max_size: int = 10,
        statement_timeout_ms: int = 30_000,
        lock_timeout_ms: int = 5_000,
    ) -> PgPool:
        password = expose(read_secret_file(password_file))
        dsn = (
            f"host={host} port={port} dbname={db} user={user} password={password} "
            f"sslmode=disable application_name=vigil-py-worker "
            f"options='-c statement_timeout={statement_timeout_ms} "
            f"-c lock_timeout={lock_timeout_ms} "
            f"-c idle_in_transaction_session_timeout=60000'"
        )
        return cls(dsn, min_size=min_size, max_size=max_size)

    async def open(self) -> None:
        await self._pool.open(wait=True, timeout=10)

    async def close(self) -> None:
        await self._pool.close()

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[psycopg.AsyncConnection[Any]]:
        async with self._pool.connection() as conn:
            yield conn

    async def fetchone(
        self,
        sql: str,
        params: tuple[Any, ...] | None = None,
    ) -> tuple[Any, ...] | None:
        async with self.connection() as conn, conn.cursor() as cur:
            await cur.execute(sql, params)
            return await cur.fetchone()

    async def fetchall(
        self,
        sql: str,
        params: tuple[Any, ...] | None = None,
    ) -> list[tuple[Any, ...]]:
        async with self.connection() as conn, conn.cursor() as cur:
            await cur.execute(sql, params)
            rows = await cur.fetchall()
            return list(rows)

    async def execute(self, sql: str, params: tuple[Any, ...] | None = None) -> int:
        async with self.connection() as conn, conn.cursor() as cur:
            await cur.execute(sql, params)
            await conn.commit()
            return cur.rowcount

    async def healthcheck(self) -> None:
        try:
            await asyncio.wait_for(self.fetchone("SELECT 1"), timeout=2.0)
        except Exception as e:  # noqa: BLE001
            raise VigilError(
                code="PG_HEALTHCHECK_FAILED",
                message=f"postgres healthcheck failed: {e}",
                severity="error",
                cause=e,
            ) from e
