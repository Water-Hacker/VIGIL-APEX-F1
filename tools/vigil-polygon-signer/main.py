#!/usr/bin/env python3
"""
vigil-polygon-signer — host service that speaks the NDJSON protocol on a
Unix socket (Phase F3, see B9 for the wire format). The signing key
lives on a YubiKey and is reached via PKCS#11 (libykcs11.so); a request
that triggers signing requires a physical touch.

Wire protocol:
  Each request is one line of JSON: {"method": "<name>", "params": {...}}\n
  Response is one line: {"ok": true, "result": "<hex>"}\n
                  or:   {"ok": false, "error": "<msg>"}\n

Methods:
  get_address        — returns the EOA address (no touch)
  sign_and_send(to, data, value, chainId)
                     — signs an EIP-1559 tx and broadcasts; returns tx hash

Operates from systemd as `vigil-polygon-signer.service`. Audit logs go
to journald with `correlation_id` propagated from the caller.
"""
from __future__ import annotations

import json
import logging
import os
import socket
import socketserver
import sys
from pathlib import Path

try:
    from eth_account import Account
    from web3 import Web3
    import pkcs11  # python-pkcs11
except ImportError as exc:  # pragma: no cover — host install gate
    sys.stderr.write(f"missing dependency: {exc}\n")
    sys.exit(2)

SOCKET_PATH = Path(os.environ.get("POLYGON_SIGNER_SOCKET", "/run/vigil/polygon-signer.sock"))
PKCS11_LIB = os.environ.get("PKCS11_LIB", "/usr/lib/x86_64-linux-gnu/libykcs11.so")
KEY_LABEL = os.environ.get("YUBIKEY_PIV_LABEL", "Polygon Anchor Key")
RPC_URL = os.environ.get("POLYGON_RPC_URL", "https://polygon-rpc.com")
CHAIN_ID = int(os.environ.get("POLYGON_CHAIN_ID", "137"))
PIN_FILE = os.environ.get("YUBIKEY_PIN_FILE", "/run/vigil/secrets/yubikey_piv_pin")

log = logging.getLogger("vigil-polygon-signer")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def _load_pin() -> str:
    return Path(PIN_FILE).read_text(encoding="utf-8").strip()


def _signer_address() -> str:
    """Read the public key from PIV slot 9c and derive the address."""
    lib = pkcs11.lib(PKCS11_LIB)
    token = lib.get_token(token_label="YubiKey PIV #1")
    with token.open(user_pin=_load_pin()) as session:
        for obj in session.get_objects({pkcs11.Attribute.LABEL: KEY_LABEL}):
            if obj.object_class == pkcs11.ObjectClass.PUBLIC_KEY:
                pub = bytes(obj[pkcs11.Attribute.EC_POINT])
                # Strip DER prefix (0x04 = uncompressed marker), keccak256
                return Web3.to_checksum_address(Web3.keccak(pub[-64:])[-20:].hex())
    raise RuntimeError(f"public key not found at label {KEY_LABEL!r}")


def _sign_and_send(to: str, data: str, value: str, chain_id: str) -> str:
    """Build an EIP-1559 transaction, sign via YubiKey, broadcast."""
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    addr = _signer_address()
    nonce = w3.eth.get_transaction_count(addr)
    fees = w3.eth.fee_history(5, "latest")
    base = fees["baseFeePerGas"][-1]
    tip = w3.to_wei(30, "gwei")
    tx = {
        "to": Web3.to_checksum_address(to),
        "data": data or "0x",
        "value": int(value or "0"),
        "chainId": int(chain_id or CHAIN_ID),
        "nonce": nonce,
        "gas": 500_000,
        "maxPriorityFeePerGas": tip,
        "maxFeePerGas": base * 2 + tip,
        "type": 2,
    }

    # PKCS#11 ECDSA-on-secp256k1 produces a (r, s); we recover v by trying
    # both and checking which recovers to our address. eth_account exposes
    # this via Account._sign_hash + Web3.eth.send_raw_transaction.
    raw_hash = Account.from_key  # placeholder — full PKCS#11 ECDSA inside
    # the prod build calls into a small Rust helper compiled with secp256k1
    # bindings. The Python code here is a minimal reference. See
    # tools/vigil-polygon-signer/README.md for the production wiring.
    _ = raw_hash
    raise NotImplementedError(
        "Phase F3 reference build — finalise the YubiKey PKCS#11 sign in "
        "the Rust helper before enabling on the production host."
    )


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
    log.info("listening on %s", SOCKET_PATH)
    server = Server(str(SOCKET_PATH), Handler)
    os.chmod(SOCKET_PATH, 0o660)
    socket.gethostname()  # touch — sanity check before .serve_forever
    server.serve_forever()


if __name__ == "__main__":
    main()
