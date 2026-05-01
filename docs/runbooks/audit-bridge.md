# Runbook — audit-bridge

> UDS sidecar. Tiny. Receives `audit.append` HTTP POSTs over a Unix
> socket, hash-chains the row, persists to `audit.actions`. The
> chokepoint that makes halt-on-failure work for the dashboard.
>
> **Service:** [`apps/audit-bridge/`](../../apps/audit-bridge/) — listens on `/run/vigil/audit-bridge.sock`.

---

## Description

### 🇫🇷

Bridge UDS pour l'émission d'événements d'audit. Le dashboard et
les workers font un `POST /append` ; le bridge calcule le record
hash, lie au record précédent, persiste dans `audit.actions`. Si
le bridge tombe, les writes échouent fail-closed (DECISION-012
halt-on-failure).

### 🇬🇧

UDS bridge for audit-event emit. Dashboard and workers `POST /append`;
the bridge computes the record hash, links to prior, persists
to `audit.actions`. Bridge down → writes fail closed (DECISION-012
halt-on-failure).

---

## Boot sequence

1. `getDb()` — Postgres.
2. `HashChain` instantiated for `audit.actions`.
3. UDS server listens on `/run/vigil/audit-bridge.sock` (mounted
   into every dashboard / worker container).

---

## Health-check signals

| Metric                          | Healthy | Unhealthy → action                                          |
| ------------------------------- | ------- | ----------------------------------------------------------- |
| Process up + socket file exists | true    | absent for > 30 s → P0 (every audit-emitting service halts) |

## SLO signals

| Metric                              | SLO target   | Investigate-worthy                     |
| ----------------------------------- | ------------ | -------------------------------------- |
| `vigil_audit_chain_seq` growth rate | matches load | flat → no audit traffic OR socket dead |
| append latency p99                  | < 50 ms      | > 200 ms → DB bottleneck               |

---

## Common failures

| Symptom                                                | Likely cause                        | Mitigation                                                                 |
| ------------------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------- |
| Dashboard returns 503 with `audit-emitter-unavailable` | bridge down                         | `docker compose restart audit-bridge`; halt-on-failure expected behaviour. |
| HASH_CHAIN_BROKEN error                                | DB row tampering or migration drift | Page architect 24/7; do not bypass.                                        |

---

## R1 — Routine deploy

```sh
docker compose pull audit-bridge
docker compose up -d audit-bridge
```

Brief 503 window during restart is the expected halt-on-failure path.

## R2 — Restore from backup

`audit.actions` lives in Postgres ([postgres.md R2](./postgres.md)).
Audit-bridge has no local state.

## R3 — Credential rotation

N/A — service has no rotatable external credential. The UDS socket
is filesystem-permissions-gated (mode 0660, owned by the `vigil`
unix group); access is via container mount, not network auth.

## R5 — Incident response

| Severity | Trigger                               | Action                                                                       |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| **P0**   | bridge down → halt-on-failure cascade | Page architect 24/7. All audit-emitting services halt; restart bridge first. |
| **P0**   | HASH_CHAIN_BROKEN                     | Page architect. Stop all writes. Do not auto-resync.                         |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included in scope (post-restore halt-on-failure round-trip test).
See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).

---

## Cross-references

- [`apps/audit-bridge/src/`](../../apps/audit-bridge/src/) — UDS server.
- [`packages/audit-chain/src/hash-chain.ts`](../../packages/audit-chain/src/hash-chain.ts) — chain logic.
- **DECISION-012** / TAL-PA — halt-on-failure semantics.
- **SRD §17.4** — three-witness audit chain.
