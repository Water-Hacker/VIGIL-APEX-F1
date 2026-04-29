"""Audit-bridge client — POSTs to the Node sidecar's UDS HTTP endpoint.

DECISION-010 — non-TS workers route audit appends through this single
chokepoint so the canonical hash chain in `audit.actions` records every
satellite fetch alongside TS-side activity. Failure is non-fatal at the
caller level (the satellite computation already succeeded by the time we
attempt to log it); we record metrics + structured logs so silent loss
shows up in observability.
"""

from __future__ import annotations

import json
import socket
from dataclasses import dataclass
from typing import Any

from vigil_common.logging import get_logger

_logger = get_logger("vigil-satellite.audit-bridge")


@dataclass(frozen=True)
class AuditBridgeResult:
    seq: int
    body_hash: str


class AuditBridgeClient:
    """Tiny HTTP/1.1-over-UDS client for `POST /append`.

    We avoid an aiohttp/httpx dependency for a 200-byte POST against a Unix
    domain socket — the synchronous urlopen-style implementation below is
    sufficient and ships zero new wheels into the worker image.
    """

    def __init__(self, socket_path: str) -> None:
        self._socket_path = socket_path

    def append(
        self,
        *,
        action: str,
        actor: str,
        subject_kind: str,
        subject_id: str,
        payload: dict[str, Any],
    ) -> AuditBridgeResult | None:
        body = json.dumps(
            {
                "action": action,
                "actor": actor,
                "subject_kind": subject_kind,
                "subject_id": subject_id,
                "payload": payload,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        request_lines = [
            b"POST /append HTTP/1.1",
            b"Host: audit-bridge",
            b"User-Agent: vigil-satellite-audit/0.1",
            b"Content-Type: application/json",
            f"Content-Length: {len(body)}".encode("ascii"),
            b"Connection: close",
            b"",
            b"",
        ]
        request = b"\r\n".join(request_lines) + body

        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                s.settimeout(5.0)
                s.connect(self._socket_path)
                s.sendall(request)
                chunks: list[bytes] = []
                while True:
                    chunk = s.recv(4096)
                    if not chunk:
                        break
                    chunks.append(chunk)
            raw = b"".join(chunks)
        except (OSError, socket.timeout) as e:
            _logger.warning(
                "audit-bridge-uds-unavailable",
                socket_path=self._socket_path,
                error=str(e),
            )
            return None

        head, _, body_bytes = raw.partition(b"\r\n\r\n")
        first_line, *_ = head.split(b"\r\n", 1)
        try:
            status = int(first_line.split(b" ", 2)[1])
        except (IndexError, ValueError):
            status = 0
        if status != 200:
            _logger.warning(
                "audit-bridge-error",
                status=status,
                response=body_bytes[:200].decode("utf-8", errors="replace"),
            )
            return None
        try:
            decoded = json.loads(body_bytes.decode("utf-8"))
            return AuditBridgeResult(
                seq=int(decoded["seq"]),
                body_hash=str(decoded["body_hash"]),
            )
        except (json.JSONDecodeError, KeyError, ValueError):
            _logger.warning("audit-bridge-invalid-json")
            return None
