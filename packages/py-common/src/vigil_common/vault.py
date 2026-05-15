"""Thin wrapper over hvac for Vault KV-v2 reads + auto-token-renewal.

Mirrors `@vigil/security/vault.ts`. Workers never see the raw token; they call
:meth:`read` to get a :class:`Secret`.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any

import hvac
from tenacity import retry, stop_after_attempt, wait_exponential

from .errors import VigilError
from .logging import get_logger
from .secrets import Secret, expose, read_secret_file

_logger = get_logger("vigil-common.vault")


class VaultClient:
    """KV-v2 reader + auto-renewing AppRole / file-token client."""

    def __init__(
        self,
        *,
        addr: str,
        token: Secret[str],
        kv_mount: str = "secret",
    ) -> None:
        self._client = hvac.Client(url=addr, token=expose(token))
        self._kv_mount = kv_mount
        self._renew_thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    @classmethod
    def from_settings(
        cls,
        *,
        addr: str,
        token_file: str,
        kv_mount: str = "secret",
    ) -> VaultClient:
        token = read_secret_file(token_file)
        return cls(addr=addr, token=token, kv_mount=kv_mount)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=0.5, max=4))
    def read(self, path: str, field: str) -> Secret[str]:
        full = f"{path}"
        try:
            res = self._client.secrets.kv.v2.read_secret_version(
                mount_point=self._kv_mount,
                path=full,
                raise_on_deleted_version=True,
            )
        except Exception as e:
            raise VigilError(
                code="VAULT_READ_FAILED",
                message=f"Vault read failed: {full}/{field}",
                severity="error",
                cause=e,
            ) from e
        data: dict[str, Any] = res["data"]["data"]
        if field not in data:
            raise VigilError(
                code="VAULT_FIELD_MISSING",
                message=f"Field '{field}' missing from {full}",
                severity="error",
            )
        return Secret(str(data[field]))

    def start_renew(self, *, interval_s: float = 1500.0) -> None:
        """Background thread: renew the auth token every `interval_s` seconds."""
        if self._renew_thread is not None:
            return
        self._stop_event.clear()
        thread = threading.Thread(target=self._renew_loop, args=(interval_s,), daemon=True)
        thread.start()
        self._renew_thread = thread

    def _renew_loop(self, interval_s: float) -> None:
        while not self._stop_event.is_set():
            try:
                self._client.auth.token.renew_self()
                _logger.debug("vault-token-renewed")
            except Exception as e:
                _logger.warning("vault-token-renew-failed", error=str(e))
            self._stop_event.wait(timeout=interval_s)

    async def aclose(self) -> None:
        self._stop_event.set()
        if self._renew_thread is not None:
            self._renew_thread.join(timeout=2)
        # hvac is sync; nothing further to await
        await asyncio.sleep(0)
