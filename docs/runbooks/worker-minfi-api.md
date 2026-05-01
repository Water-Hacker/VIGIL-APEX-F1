# Runbook — worker-minfi-api

> MOU-gated MINFI Budget Information System adapter. Authenticates
> via mTLS to the MINFI direct API once the MOU is countersigned.
> Phase-1: refuses to run without `MINFI_BIS_MOU_ACK=1`.
>
> **Service:** [`apps/worker-minfi-api/`](../../apps/worker-minfi-api/) — placeholder until the MOU lands.

---

## Description

### 🇫🇷

Adaptateur API directe MINFI (mTLS). MOU-gated : refuse de tourner
sans `MINFI_BIS_ENABLED=1` ET `MINFI_BIS_MOU_ACK=1`. Une fois le
MOU contresigné, ingère le delta quotidien des engagements +
liquidations + ordonnancements depuis le BIS MINFI ; émet
`vigil:source:event` pour worker-extractor.

### 🇬🇧

Direct MINFI API adapter (mTLS). MOU-gated: refuses to run without
`MINFI_BIS_ENABLED=1` AND `MINFI_BIS_MOU_ACK=1`. Once the MOU is
countersigned, ingests the daily delta of engagements + liquidations

- ordonnancements from MINFI BIS; emits `vigil:source:event` for
  worker-extractor.

---

## Boot sequence

1. Verifies `MINFI_BIS_ENABLED` + `MINFI_BIS_MOU_ACK` env both `1`;
   refuses to start otherwise (AUDIT-001 mou-gate).
2. Reads mTLS cert + key + CA from Vault (`secret/minfi-bis/{client_cert, client_key, ca_cert}`).
3. Establishes mTLS connection to MINFI BIS endpoint
   (`MINFI_BIS_BASE_URL`).
4. Cron-scheduled daily fetch.

---

## Health-check signals

| Metric                                        | Healthy             | Unhealthy → action                      |
| --------------------------------------------- | ------------------- | --------------------------------------- |
| `up{instance=~".*worker-minfi-api.*"}`        | `1` (if MOU active) | `0` > 2 min → P1 (if MOU active)        |
| Adapter health row in `source.adapter_health` | `OK`                | `mou-gated-disabled` → expected pre-MOU |

## SLO signals

| Metric                | SLO target           | Investigate-worthy             |
| --------------------- | -------------------- | ------------------------------ |
| Daily fetch row count | matches MINFI volume | < 50 % of expected → check API |
| Fetch latency p99     | < 30 s               | > 5 min → MINFI API slow       |

---

## Common failures

| Symptom                                     | Likely cause                               | Mitigation                                                     |
| ------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| Worker refuses to start, log: `MOU pending` | expected pre-MOU; not a fault              | No action until MOU countersigned per R7-mou-activation.       |
| mTLS handshake fails post-MOU               | cert expired / endpoint URL changed        | Verify Vault paths + cert validity; coordinate with MINFI ops. |
| Daily fetch row count drops to 0            | MINFI API access revoked OR endpoint moved | Page architect; verify MOU still active.                       |

---

## R1 — Routine deploy

```sh
docker compose pull worker-minfi-api
docker compose up -d worker-minfi-api
```

Pre-MOU: container exits cleanly with mou-gate refusal log; that's
expected.

## R2 — Restore from backup

Reads source events into Postgres `source.events`; no local state.
mTLS material lives in Vault.

## R3 — Credential rotation

mTLS rotation per the MOU's annex 3 (typically annual). Procedure:

```sh
# 1. MINFI provides new client.crt + client.key + ca.crt bundle.
# 2. Update Vault:
vault kv put secret/minfi-bis client_cert=@client.crt \
  client_key=@client.key ca_cert=@ca.crt
# 3. Restart worker so it re-reads the bundle on boot:
docker compose restart worker-minfi-api
# 4. Verify next daily fetch succeeds.
```

The architect coordinates with MINFI/DGTCFM per R7-mou-activation
section "MINFI" for the rotation window.

## R5 — Incident response

| Severity | Trigger                                 | Action                                                                        |
| -------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| **P1**   | mTLS handshake failures sustained > 6 h | Page architect. Risk: pre-rotation cert expired without notification.         |
| **P2**   | Fetch row count anomaly                 | Coordinate with MINFI ops; verify upstream BIS health.                        |
| **P3**   | Pre-MOU container restart loop          | Operator triage; mou-gate-regression test ensures the refusal is intentional. |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included only post-MOU; pre-MOU the worker is a no-op.

---

## Cross-references

- [`apps/adapter-runner/src/adapters/minfi-bis.ts`](../../apps/adapter-runner/src/adapters/minfi-bis.ts) — adapter implementation.
- [`apps/adapter-runner/__tests__/mou-gate-regression.test.ts`](../../apps/adapter-runner/__tests__/mou-gate-regression.test.ts) — AUDIT-001 mou-gate pin.
- [`docs/runbooks/R7-mou-activation.md`](./R7-mou-activation.md) — MOU activation procedure.
- **DECISION-007 / DECISION-008** — MINFI mTLS adapter scaffolding.
- **HSK-v1 §6** — credential rotation cadence.
