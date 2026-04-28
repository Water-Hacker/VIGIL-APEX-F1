"""
Locust load test — MINFI /score API.

Phase F7. SLA target: p95 < 100ms @ 100 rps with mTLS active. The mTLS
client cert is taken from $MINFI_TEST_CERT / $MINFI_TEST_KEY so the
test simulates a real MINFI integration.

Run:
  locust -f load-tests/locust-minfi-api.py \
    --host=https://localhost:4001 \
    --users=200 --spawn-rate=20 --run-time=5m \
    --headless --tls-cert=$MINFI_TEST_CERT --tls-key=$MINFI_TEST_KEY
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import random
import time
import uuid
from typing import Any

from locust import FastHttpUser, between, task

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
except ImportError:  # CI installs it
    raise SystemExit("locust-minfi-api requires `cryptography`")


# ---- Helpers ----------------------------------------------------------------

# Test signing key — generated fresh per run; in CI we pre-load a fixed
# key fingerprint into Vault `secret/vigil/minfi-api/minfi_request_public_key`
# so the worker accepts our signature.
_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())


def sign_body(body_bytes: bytes) -> str:
    sig = _PRIVATE_KEY.sign(body_bytes, ec.ECDSA(hashes.SHA256()))
    return base64.b64encode(sig).decode("ascii")


REGIONS = ["CE", "LT", "NW", "SW", "OU", "SU", "ES", "EN", "NO", "AD"]


def make_request_payload() -> dict[str, Any]:
    return {
        "request_id": str(uuid.uuid4()),
        "contract_reference": f"ARMP-2026-{random.randint(1, 99999):05d}",
        "amount_xaf": random.randint(1_000_000, 10_000_000_000),
        "recipient": {
            "rccm": f"CM-DLA-{random.randint(2018, 2026)}-B-{random.randint(1, 99999):05d}",
            "niu": f"M{random.randint(1_000_000_000, 9_999_999_999)}",
            "name": f"Société Test {random.randint(1, 1000)} SARL",
        },
        "payment_date": "2026-04-28",
        "region": random.choice(REGIONS),
    }


# ---- User classes -----------------------------------------------------------

class MinfiScoringUser(FastHttpUser):
    wait_time = between(0.1, 0.5)

    @task(95)
    def score_request(self) -> None:
        payload = make_request_payload()
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        sig = sign_body(body)
        with self.client.post(
            "/score",
            data=body,
            headers={
                "content-type": "application/json",
                "x-minfi-signature": sig,
            },
            catch_response=True,
            name="/score",
        ) as r:
            if r.status_code != 200:
                r.failure(f"http {r.status_code}: {r.text[:120]}")
                return
            try:
                resp = r.json()
            except Exception as e:
                r.failure(f"json parse: {e}")
                return
            if "band" not in resp:
                r.failure("missing band")
                return
            r.success()

    @task(5)
    def healthz(self) -> None:
        self.client.get("/healthz", name="/healthz")
