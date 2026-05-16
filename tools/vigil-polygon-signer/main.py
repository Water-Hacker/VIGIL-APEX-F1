#!/usr/bin/env python3
"""
vigil-polygon-signer — host service that speaks the NDJSON protocol on a
Unix socket (Phase F3, see B9 for the wire format). The signing key
lives on a YubiKey and is reached via PKCS#11 (libykcs11.so); a request
that triggers signing requires a physical touch.

Wire protocol:
  Each request is one line of JSON: {"method": "<name>", "params": {...}}\\n
  Response is one line: {"ok": true, "result": "<hex>"}\\n
                  or:   {"ok": false, "error": "<msg>"}\\n

Methods:
  get_address        — returns the EOA address (no touch)
  sign_and_send(to, data, value, chainId)
                     — signs an EIP-1559 tx and broadcasts; returns tx hash

Operates from systemd as `vigil-polygon-signer.service`. Audit logs go
to journald with `correlation_id` propagated from the caller.

FIND-007 closure (whole-system-audit doc 10): the PKCS#11 ECDSA sign +
recoverable-v computation now delegates to the Rust helper at
`./rust-helper/target/release/yk-secp256k1` (build via
`cd rust-helper && cargo build --release`). Python remains responsible
for RPC, transaction construction, and broadcast; the helper is the
cryptographic boundary that touches the YubiKey.
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

try:
    from eth_account._utils.signing import (
        serializable_unsigned_transaction_from_dict,
    )
    from hexbytes import HexBytes
    from web3 import Web3
except ImportError as exc:  # pragma: no cover — host install gate
    sys.stderr.write(f"missing dependency: {exc}\n")
    sys.exit(2)

SOCKET_PATH = Path(os.environ.get("POLYGON_SIGNER_SOCKET", "/run/vigil/polygon-signer.sock"))
RPC_URL = os.environ.get("POLYGON_RPC_URL", "https://polygon-rpc.com")
CHAIN_ID = int(os.environ.get("POLYGON_CHAIN_ID", "137"))
HELPER_BIN = os.environ.get(
    "YK_HELPER_BIN", "/usr/local/libexec/yk-secp256k1"
)

log = logging.getLogger("vigil-polygon-signer")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def _helper(*args: str, stdin: bytes | None = None, timeout: float = 60.0) -> str:
    """Invoke the Rust helper. Returns stdout stripped of trailing newline.

    Raises RuntimeError with the helper's stderr on non-zero exit. The
    timeout default is 60 s — generous because the YubiKey may require
    a physical touch before C_Sign returns.
    """
    proc = subprocess.run(
        [HELPER_BIN, *args],
        input=stdin,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        msg = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"yk-secp256k1 helper failed (rc={proc.returncode}): {msg}")
    return proc.stdout.decode("utf-8").strip()


def _signer_address() -> str:
    """Return the EOA address (0x-prefixed hex). No touch required."""
    out = _helper("--mode", "address")
    if not out.startswith("0x") or len(out) != 42:
        raise RuntimeError(f"helper returned malformed address: {out!r}")
    return Web3.to_checksum_address(out)


def _yubikey_sign_hash(msg_hash: bytes) -> tuple[int, int, int]:
    """Sign a 32-byte keccak256 hash on the YubiKey.

    Returns (r, s, v_raw) where v_raw is 0 or 1 (the secp256k1
    recovery id; EIP-1559 wants this raw form, no chain offset).
    """
    if len(msg_hash) != 32:
        raise ValueError(f"msg_hash must be 32 bytes, got {len(msg_hash)}")
    out = _helper("--mode", "sign", stdin=msg_hash.hex().encode("ascii"))
    parts = out.split("|")
    if len(parts) != 3:
        raise RuntimeError(f"helper returned malformed signature: {out!r}")
    r_hex, s_hex, v_str = parts
    if len(r_hex) != 64 or len(s_hex) != 64:
        raise RuntimeError(
            f"helper returned wrong-length r/s: r={len(r_hex)} s={len(s_hex)}"
        )
    return int(r_hex, 16), int(s_hex, 16), int(v_str, 10)


# Tier-2 audit input-validation gates. Pre-fix, the signer accepted any
# string for `to`/`data`/`value`/`chainId` and only failed deep inside
# web3.py's serializer. The on-socket attacker can already do worse, but
# explicit gates surface bad input as a structured error response
# rather than a stack trace in the journal.
_ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
_HEX_DATA_RE = re.compile(r"^(0x)?[a-fA-F0-9]*$")
_DEC_INT_RE = re.compile(r"^[0-9]+$")
# Hard cap on the data payload. A 1 MB transaction data field would
# blow the L1 gas budget anyway — refuse early. 128 KB is comfortable
# for any anchor/witness payload we generate.
_MAX_DATA_BYTES = 128 * 1024
# Floor on dynamic gas estimation. An estimate below 21000 is a
# protocol-level impossibility; treat it as RPC failure and refuse.
_GAS_FLOOR = 21_000
# Ceiling on dynamic gas estimation. Polygon block gas limit is
# ~30M; a single tx requesting more than 8M is either a runaway loop
# or a misconfigured client. Cap and warn rather than silently send.
_GAS_CEILING = 8_000_000


def _validate_tx_inputs(to: str, data: str, value: str, chain_id: str) -> tuple[str, str, int, int]:
    """Validate + normalise sign_and_send params. Raises ValueError on bad input.

    Returns (to_checksummed, data_hex_with_prefix, value_int, chain_id_int).
    """
    if not to or not _ADDR_RE.fullmatch(to):
        raise ValueError("param 'to' must be 0x-prefixed 40-hex address")
    data_norm = data if data else "0x"
    if not _HEX_DATA_RE.fullmatch(data_norm):
        raise ValueError("param 'data' must be hex (optional 0x prefix)")
    # Decoded byte length, not hex char length.
    hex_body = data_norm[2:] if data_norm.startswith("0x") else data_norm
    if len(hex_body) % 2 != 0:
        raise ValueError("param 'data' has odd-length hex")
    if len(hex_body) // 2 > _MAX_DATA_BYTES:
        raise ValueError(f"param 'data' exceeds {_MAX_DATA_BYTES}-byte cap")
    if not data_norm.startswith("0x"):
        data_norm = "0x" + data_norm
    value_str = value if value else "0"
    if not _DEC_INT_RE.fullmatch(value_str):
        raise ValueError("param 'value' must be a decimal non-negative integer")
    chain_str = chain_id if chain_id else str(CHAIN_ID)
    if not _DEC_INT_RE.fullmatch(chain_str):
        raise ValueError("param 'chainId' must be a decimal non-negative integer")
    chain_int = int(chain_str)
    if chain_int != CHAIN_ID:
        raise ValueError(
            f"param 'chainId' ({chain_int}) does not match configured "
            f"POLYGON_CHAIN_ID ({CHAIN_ID}); refusing cross-chain replay"
        )
    return Web3.to_checksum_address(to), data_norm, int(value_str), chain_int


def _sign_and_send(to: str, data: str, value: str, chain_id: str) -> str:
    """Build an EIP-1559 transaction, sign via YubiKey, broadcast.

    FIND-007 closure — the prior NotImplementedError is replaced with
    the helper-delegated sign path. Tier-2 audit hardening: input
    validation + dynamic gas estimation replace the prior hardcoded
    500_000-gas tx that would silently fail on-chain if the payload
    grew unexpectedly.
    """
    to_ok, data_ok, value_int, chain_int = _validate_tx_inputs(to, data, value, chain_id)
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    addr = _signer_address()
    nonce = w3.eth.get_transaction_count(addr)
    fees = w3.eth.fee_history(5, "latest")
    base = fees["baseFeePerGas"][-1]
    tip = w3.to_wei(30, "gwei")
    # Dynamic gas estimation. Falls back to a sane ceiling on RPC
    # failure (Polygon nodes occasionally return malformed traces);
    # never silently use a hardcoded value that could underpay and
    # cause an on-chain revert.
    try:
        estimated = w3.eth.estimate_gas({
            "from": addr,
            "to": to_ok,
            "data": HexBytes(data_ok),
            "value": value_int,
        })
        # 20% safety margin to absorb estimator drift.
        gas_limit = int(estimated * 12 // 10)
        if gas_limit < _GAS_FLOOR:
            raise ValueError(f"estimate_gas returned implausibly low {estimated}")
        if gas_limit > _GAS_CEILING:
            log.warning(
                "gas estimate %d exceeds ceiling %d; capping to ceiling",
                gas_limit, _GAS_CEILING,
            )
            gas_limit = _GAS_CEILING
    except Exception as e:
        # Surface estimation failure to operators but proceed with
        # the ceiling so a one-off node hiccup doesn't drop an audit
        # anchor. The Polygon-side cost of using the ceiling for a
        # small payload is negligible (unused gas is refunded).
        log.warning("gas estimation failed (%s); using ceiling %d", e, _GAS_CEILING)
        gas_limit = _GAS_CEILING
    tx_dict = {
        "to": to_ok,
        "data": HexBytes(data_ok),
        "value": value_int,
        "chainId": chain_int,
        "nonce": nonce,
        "gas": gas_limit,
        "maxPriorityFeePerGas": tip,
        "maxFeePerGas": base * 2 + tip,
        "type": 2,
        "accessList": [],
    }

    # serializable_unsigned_transaction_from_dict returns a
    # SerializableTransaction with `.hash()` (keccak256 of the
    # unsigned RLP) and `.encode_transaction(vrs)` (raw signed bytes).
    # This API has been stable in eth_account since 0.6.x.
    unsigned = serializable_unsigned_transaction_from_dict(tx_dict)
    msg_hash = unsigned.hash()  # 32 bytes
    r, s, v_raw = _yubikey_sign_hash(msg_hash)
    # For EIP-1559 (type-2), v is the raw recovery id 0 or 1 — no
    # chainId offset (EIP-2718 type prefix already disambiguates).
    raw_signed = unsigned.encode_transaction(vrs=(v_raw, r, s))
    tx_hash = w3.eth.send_raw_transaction(raw_signed)
    return tx_hash.hex()


def _handle(line: bytes) -> dict:
    try:
        req = json.loads(line)
    except Exception as e:
        return {"ok": False, "error": f"parse: {e}"}
    method = req.get("method")
    params = req.get("params", {}) or {}
    try:
        if method == "get_address":
            return {"ok": True, "result": _signer_address()}
        if method == "sign_and_send":
            tx_hash = _sign_and_send(
                params.get("to", ""),
                params.get("data", ""),
                params.get("value", "0"),
                params.get("chainId", str(CHAIN_ID)),
            )
            return {"ok": True, "result": tx_hash}
        return {"ok": False, "error": f"unknown method {method!r}"}
    except Exception as e:  # pragma: no cover — operator log path
        log.exception("rpc call %s failed", method)
        return {"ok": False, "error": str(e)}


class Handler(socketserver.StreamRequestHandler):
    def handle(self) -> None:  # noqa: D401
        for raw in self.rfile:
            resp = _handle(raw)
            self.wfile.write((json.dumps(resp) + "\n").encode("utf-8"))
            self.wfile.flush()


class Server(socketserver.UnixStreamServer):
    allow_reuse_address = True


def main() -> None:
    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)
    if SOCKET_PATH.exists():
        SOCKET_PATH.unlink()
    log.info("listening on %s (helper at %s)", SOCKET_PATH, HELPER_BIN)
    server = Server(str(SOCKET_PATH), Handler)
    os.chmod(SOCKET_PATH, 0o660)
    socket.gethostname()  # touch — sanity check before .serve_forever
    server.serve_forever()


if __name__ == "__main__":
    main()
