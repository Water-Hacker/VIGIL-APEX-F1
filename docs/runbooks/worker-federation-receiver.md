# Runbook — worker-federation-receiver

> Phase-3 scaffolded. Central federation receiver — verifies
> region-signed envelopes via the central Vault PKI, persists, then
> forwards to the data-plane workers. Phase-1: tests only.
>
> **Service:** [`apps/worker-federation-receiver/`](../../apps/worker-federation-receiver/) — Phase-3 federation receiver; gRPC server.

---

## Description

### 🇫🇷

Receveur fédéré central. Vérifie la signature de chaque envelope
contre le PKI Vault central + applique replay-protection +
region-prefix enforcement + payload-cap. Persiste dans
`federation.inbound_envelope` ; émet sur le stream interne pour les
workers data-plane.

### 🇬🇧

Central federation receiver. Verifies each envelope's signature
against the central Vault PKI + applies replay-protection +
region-prefix enforcement + payload-cap. Persists to
`federation.inbound_envelope`; emits to the internal stream for
data-plane workers.

---

## Boot sequence

1. gRPC server bind on `FEDERATION_RECEIVER_PORT` (default 50051).
2. Vault PKI client — reads region pubkey directory.
3. Postgres for inbound persistence.
4. Federation key directory monitored (AUDIT-013); reload on file
   change.

---

## Health-check signals

| Metric                                           | Healthy (Phase 3) | Unhealthy → action                                      |
| ------------------------------------------------ | ----------------- | ------------------------------------------------------- |
| `up{instance=~".*worker-federation-receiver.*"}` | `1` (Phase 3)     | `0` > 5 min → P1 (Phase 3)                              |
| `vigil_federation_keys_loaded{directory!=""}`    | > 0               | `== 0` → P1 (no peer keys; receiver rejects everything) |

## SLO signals

| Metric                          | SLO target       | Investigate-worthy                                                     |
| ------------------------------- | ---------------- | ---------------------------------------------------------------------- |
| Per-envelope verify latency p99 | < 100 ms         | > 1 s → key directory fs slow                                          |
| Reject rate by reason           | matches expected | drift in `SIGNATURE_INVALID` / `REGION_MISMATCH` → key drift OR attack |

---

## Common failures (Phase-3)

| Symptom                                       | Likely cause                                      | Mitigation                                                                           |
| --------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| All envelopes rejected with SIGNATURE_INVALID | key directory unreadable OR region pubkey rotated | `vigil_federation_keys_loaded{directory=""}=0` alert. Check fs perms + dir contents. |
| Replay-protection rejecting valid retries     | receiver's replay-cache TTL too short             | Tune `FEDERATION_REPLAY_CACHE_TTL_S`.                                                |
| Region-prefix mismatch sustained              | sender misconfigured region OR malicious envelope | Investigate sender; possibly halt that region.                                       |

---

## R1 — Routine deploy (Phase-3 only)

```sh
docker compose pull worker-federation-receiver
docker compose up -d worker-federation-receiver
```

## R2 — Restore from backup

Reads peer-key directory; writes `federation.inbound_envelope`. No
local state beyond replay-cache (in-memory; rebuilt on restart with
acceptable redundant-rejection edge during cache warmup).

## R3 — Credential rotation

Per-region pubkey rotation per
[R10-federation-key-rotation.md](./R10-federation-key-rotation.md).
The receiver detects new key files via the directory-resolver; no
restart needed for additions. Removals require restart to clear
the in-memory accept set.

## R5 — Incident response (Phase-3 only)

| Severity | Trigger                                          | Action                                                             |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| **P1**   | `vigil_federation_keys_loaded == 0` for > 5 min  | Page architect. AUDIT-013: receiver silently rejecting everything. |
| **P1**   | Receiver down + region agents queueing envelopes | Page on-call.                                                      |
| **P2**   | High SIGNATURE_INVALID rate from one region      | Investigate that region's cert; possibly cert-rotation drift.      |
| **P3**   | Single envelope rejected with PAYLOAD_TOO_LARGE  | Operator triage; sender-side payload bug.                          |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Phase-1: smoke-boot only. Phase-3: full federation cutover.

---

## Cross-references

### Code

- [`apps/worker-federation-receiver/src/`](../../apps/worker-federation-receiver/src/) — gRPC server.
- [`apps/worker-federation-receiver/test/integration.test.ts`](../../apps/worker-federation-receiver/test/integration.test.ts) — 40-test integration suite (in-process insecure mode).
- [`packages/federation-stream/`](../../packages/federation-stream/) — sign + verify.

### Binding spec

- **TRUTH §B.3** — Phase-3 federation scaffold.
- **AUDIT-013** — directory-resolver key-load metric.
- **AUDIT-067** — burst-of-500 envelopes acceptance test.
- **R9-federation-cutover.md** — cutover procedure.
- **R10-federation-key-rotation.md** — PKI rotation.
