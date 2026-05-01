# Runbook — audit-verifier

> Continuous chain-walker. Reads `audit.actions` end-to-end every
> hour, verifies hash linkage, emits `vigil_errors_total{code="AUDIT_HASH_CHAIN_BROKEN"}`
> on any divergence. CT-01 of SRD §30.8.
>
> **Service:** [`apps/audit-verifier/`](../../apps/audit-verifier/).

---

## Description

### 🇫🇷

Marche la chaîne `audit.actions` à intervalle horaire. Vérifie que
chaque `body_hash` égale `sha256(prev_hash || row_payload)`.
Émet une métrique d'erreur si la chaîne est rompue ; alerte
Prometheus `HashChainBreak` page l'architecte.

### 🇬🇧

Walks the `audit.actions` chain at hourly intervals. Verifies every
`body_hash` equals `sha256(prev_hash || row_payload)`. Emits an
error metric on any break; Prometheus alert `HashChainBreak`
pages the architect.

---

## Boot sequence

1. `getDb()` — Postgres read-only connection.
2. `HashChain.verify()` loop scheduled per `AUDIT_VERIFY_INTERVAL_MS`
   (default 1 h).
3. Metrics server starts on `PROMETHEUS_PORT`.

---

## Health-check signals

| Metric                                                    | Healthy | Unhealthy → action                      |
| --------------------------------------------------------- | ------- | --------------------------------------- |
| `vigil_worker_last_tick_seconds{worker="audit-verifier"}` | < 2 h   | > 2 h → P1 (alert: `WorkerLoopStalled`) |
| `vigil_errors_total{code="AUDIT_HASH_CHAIN_BROKEN"}`      | `0`     | `> 0` → P0 (alert: `HashChainBreak`)    |

## SLO signals

| Metric                     | SLO target | Investigate-worthy                                     |
| -------------------------- | ---------- | ------------------------------------------------------ |
| Verification loop duration | < 5 min    | > 30 min → chain growing faster than walker can verify |

---

## Common failures

| Symptom                                 | Likely cause                                                   | Mitigation                                                                              |
| --------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `AUDIT_HASH_CHAIN_BROKEN` error         | `audit.actions` row tampered with OR migration corrupted state | Page architect 24/7. Stop all writes. Identify divergent row by `seq`; do NOT auto-fix. |
| Walker lagging (loop duration > 30 min) | row volume outpacing verifier                                  | Bump verify interval down OR shard the walker (Phase-2 multi-process).                  |

---

## R1 — Routine deploy

```sh
docker compose pull audit-verifier
docker compose up -d audit-verifier
```

## R2 — Restore from backup

Reads `audit.actions` from Postgres; no local state. After postgres
restore, the verifier resumes from `seq=1` and walks forward.

## R3 — Credential rotation

N/A — read-only Postgres connection (uses the same Vault-rotated
service password as every other worker; no service-specific cred).

## R5 — Incident response

| Severity | Trigger                           | Action                                                              |
| -------- | --------------------------------- | ------------------------------------------------------------------- |
| **P0**   | `AUDIT_HASH_CHAIN_BROKEN` emitted | Page architect 24/7 immediately. Halt all audit-emitting services.  |
| **P1**   | Verifier loop stalled > 2 h       | Page on-call. Investigate; verifier failure means CT-01 unverified. |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Critical scope. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md). The
verifier MUST walk the chain end-to-end clean post-restore.

---

## Cross-references

- [`apps/audit-verifier/src/`](../../apps/audit-verifier/src/) — chain walker.
- [`packages/audit-chain/src/verifier.ts`](../../packages/audit-chain/src/verifier.ts) — verify logic.
- **SRD §30.8 CT-01** — continuous test.
- **DECISION-012** / TAL-PA-DOCTRINE-v1.
