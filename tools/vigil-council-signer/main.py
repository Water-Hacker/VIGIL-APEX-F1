#!/usr/bin/env python3
"""
vigil-council-signer — desktop service that speaks NDJSON on a per-user
Unix socket for the council vote signing path.

W-10 partial closure: native PKCS#11 council-vote signing replaces
WebAuthn as the primary path. WebAuthn falls back to accessibility-
edge cases.

The service runs as the user (NOT root, NOT systemd-system) on a
council member's workstation. The Tauri / Electron desktop wrapper
(future work) embeds a local web view that opens an EventSource /
fetch against this socket via a localhost bridge; the browser
dashboard talks to the wrapper over a same-origin postMessage path.

Why a separate service instead of inlining libykcs11 in the desktop
wrapper:
  1. The PKCS#11 boundary is the security surface. A bug in the
     desktop wrapper (Tauri / Electron) must not be able to issue
     extra signatures.
  2. The service can be audited / signed / reproduced independently
     of the desktop UI.
  3. The same socket works with a CLI client (`nc -U`) for SRE
     debugging and integration tests.

Wire protocol:
  Each request: {"method": "<name>", "params": {...}}\\n
  Response:     {"ok": true, "result": ...}\\n
              or {"ok": false, "error": "..."}\\n

Methods:
  get_pubkey   — returns the 0x04-prefixed uncompressed P-256 point
                  hex (130 chars). No touch.
  sign         — params: {"hash": "<64 hex chars>"}; returns
                  {"r": "<64 hex>", "s": "<64 hex>"}; touch required.

The helper protocol (subprocess) is documented in
rust-helper/src/main.rs.

Mirrors the polygon-signer protocol intentionally so a reviewer
sees one shape across both helpers.
"""
from __future__ import annotations

import json
import logging
import os
import re
import socket
import socketserver
import subprocess
import sys
from pathlib import Path

# Per-user socket path. Lives in XDG_RUNTIME_DIR (tmpfs, cleared at
# logout, mode 0o700 by default).
XDG_RUNTIME_DIR = os.environ.get("XDG_RUNTIME_DIR", "/tmp")
SOCKET_PATH = Path(
    os.environ.get("COUNCIL_SIGNER_SOCKET", f"{XDG_RUNTIME_DIR}/vigil/council-signer.sock")
)
HELPER_BIN = os.environ.get(
    "YK_HELPER_BIN", str(Path(__file__).resolve().parent / "rust-helper/target/release/yk-council-signer")
)

log = logging.getLogger("vigil-council-signer")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

_HEX_RE = re.compile(r"^[0-9a-fA-F]+$")


def _helper(mode: str, stdin: bytes | None = None, timeout: float = 60.0) -> str:
    """Invoke the Rust helper. Returns the trimmed stdout on success,
    raises RuntimeError on non-zero exit. Mirrors the polygon-signer
    helper invocation shape exactly."""
    if not Path(HELPER_BIN).exists():
        raise RuntimeError(f"helper binary not found at {HELPER_BIN}; build via `cargo build --release`")
    proc = subprocess.run(
        [HELPER_BIN, "--mode", mode],
        input=stdin,
        capture_output=True,
        timeout=timeout,
    )
    if proc.returncode != 0:
        # stderr carries the helper's anyhow chain; surface verbatim to
        # the dashboard but trim to a reasonable size so a flood of
        # cryptoki errors doesn't OOM the caller's logger.
        msg = proc.stderr.decode("utf-8", errors="replace").strip()
        if len(msg) > 4096:
            msg = msg[:4096] + "…[truncated]"
        raise RuntimeError(f"helper failure (exit {proc.returncode}): {msg}")
    return proc.stdout.decode("utf-8").strip()


def _get_pubkey() -> str:
    out = _helper("pubkey")
    if not (len(out) == 130 and out.startswith("04")):
        raise RuntimeError(
            f"helper returned malformed pubkey (len={len(out)}, prefix={out[:2]!r})"
        )
    if not _HEX_RE.match(out):
        raise RuntimeError("helper returned non-hex pubkey")
    return out


def _sign(msg_hash_hex: str) -> dict:
    if not (len(msg_hash_hex) == 64 and _HEX_RE.match(msg_hash_hex)):
        raise ValueError("hash must be 64 hex chars (32-byte SHA-256)")
    out = _helper("sign", stdin=msg_hash_hex.encode("utf-8"))
    parts = out.split("|")
    if len(parts) != 3 or parts[2] != "ok":
        raise RuntimeError(f"helper returned malformed sign output: {out!r}")
    r, s, _ = parts
    if not (len(r) == 64 and len(s) == 64 and _HEX_RE.match(r) and _HEX_RE.match(s)):
        raise RuntimeError("helper returned non-hex r or s")
    return {"r": r, "s": s}


def _handle(line: bytes) -> dict:
    try:
        req = json.loads(line)
    except Exception as e:
        return {"ok": False, "error": f"parse: {e}"}
    method = req.get("method")
    params = req.get("params", {}) or {}
    try:
        if method == "get_pubkey":
            return {"ok": True, "result": _get_pubkey()}
        if method == "sign":
            return {"ok": True, "result": _sign(params.get("hash", ""))}
        return {"ok": False, "error": f"unknown method {method!r}"}
    except ValueError as e:
        # 4xx-equivalent — caller-supplied input was bad.
        return {"ok": False, "error": f"invalid params: {e}"}
    except Exception as e:  # pragma: no cover — operator log path
        log.exception("rpc call %s failed", method)
        return {"ok": False, "error": str(e)}


# Hard cap on per-line request size, same rationale as the polygon-signer:
# defends against a misbehaving client sending an unbounded line and
# exhausting the service's memory. 4 KiB is comfortably larger than the
# largest legitimate sign request envelope (~ 200 bytes).
_MAX_REQUEST_LINE_BYTES = 4 * 1024


class Handler(socketserver.StreamRequestHandler):
    def handle(self) -> None:  # noqa: D401
        while True:
            raw = self.rfile.readline(_MAX_REQUEST_LINE_BYTES + 1)
            if not raw:
                return
            if len(raw) > _MAX_REQUEST_LINE_BYTES:
                resp = {"ok": False, "error": f"request line exceeds {_MAX_REQUEST_LINE_BYTES}-byte cap"}
                self.wfile.write((json.dumps(resp) + "\n").encode("utf-8"))
                self.wfile.flush()
                return
            resp = _handle(raw)
            self.wfile.write((json.dumps(resp) + "\n").encode("utf-8"))
            self.wfile.flush()


class Server(socketserver.UnixStreamServer):
    allow_reuse_address = True


def main() -> None:
    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        os.chmod(SOCKET_PATH.parent, 0o700)
    except OSError as exc:
        log.warning("could not tighten parent dir perms on %s: %s", SOCKET_PATH.parent, exc)
    if SOCKET_PATH.exists():
        SOCKET_PATH.unlink()
    # Strict umask so the socket node is created owner-only from the
    # outset; chmod 0o600 below is belt-and-braces.
    prior_umask = os.umask(0o177)
    try:
        log.info("listening on %s (helper at %s)", SOCKET_PATH, HELPER_BIN)
        server = Server(str(SOCKET_PATH), Handler)
    finally:
        os.umask(prior_umask)
    os.chmod(SOCKET_PATH, 0o600)
    socket.gethostname()  # touch — sanity check before .serve_forever
    server.serve_forever()


if __name__ == "__main__":
    main()
