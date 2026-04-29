"""IPFS pinning — pins satellite-fetch results so dossiers can cite them.

Talks to the local Kubo node's HTTP API at `IPFS_API_URL`, defaulting to
`http://vigil-ipfs:5001`. The pin is best-effort: if Kubo is unavailable
the worker still emits the source event without a `result_cid`, the audit
log records the failure, and a follow-up sweep re-pins on next run.
"""

from __future__ import annotations

import io
import json
from typing import Any

import httpx

from vigil_common.logging import get_logger

_logger = get_logger("vigil-satellite.ipfs")


class IpfsPinner:
    """Synchronous Kubo client. Used inside the async worker via to_thread."""

    def __init__(self, api_url: str, timeout_seconds: float = 30.0) -> None:
        self._url = api_url.rstrip("/")
        self._timeout = timeout_seconds

    def pin_json(self, payload: dict[str, Any]) -> str | None:
        body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        files = {"file": ("result.json", io.BytesIO(body), "application/json")}
        try:
            response = httpx.post(
                f"{self._url}/api/v0/add",
                params={"pin": "true", "cid-version": "1"},
                files=files,
                timeout=self._timeout,
            )
        except httpx.HTTPError as e:
            _logger.warning("ipfs-pin-failed", error=str(e))
            return None
        if response.status_code != 200:
            _logger.warning(
                "ipfs-pin-non-200",
                status=response.status_code,
                body=response.text[:200],
            )
            return None
        # Kubo returns one JSON object per file; with one file we get one line.
        try:
            decoded = json.loads(response.text.strip().splitlines()[-1])
            cid = decoded.get("Hash")
        except (json.JSONDecodeError, IndexError, AttributeError):
            _logger.warning("ipfs-pin-bad-response", body=response.text[:200])
            return None
        if not isinstance(cid, str) or not cid:
            return None
        return cid
