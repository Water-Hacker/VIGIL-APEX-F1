# Runbook — worker-fabric-bridge

> Phase-2 scaffolded per TRUTH §B.2. Postgres → Hyperledger Fabric
> replicator. Single-peer through Phase 1; multi-org cutover at
> Phase-2 entry.
>
> **Service:** [`apps/worker-fabric-bridge/`](../../apps/worker-fabric-bridge/) — replication; CT-03 cross-witness verifier feeds from this.

---

## Description

### 🇫🇷

Réplique chaque ligne `audit.actions` Postgres vers le chaincode
`audit-witness` Fabric. Phase-1 single-peer Org1 ; Phase-2 entry
ajoute CONAC + Cour des Comptes peers. Émet
`vigil_errors_total{code="AUDIT_HASH_CHAIN_BROKEN"}` si la
divergence Postgres ↔ Fabric est détectée (CT-03).

### 🇬🇧

Replicates each Postgres `audit.actions` row to the Fabric
`audit-witness` chaincode. Phase-1 single-peer Org1; Phase-2 entry
adds CONAC + Cour des Comptes peers. Emits
`vigil_errors_total{code="AUDIT_HASH_CHAIN_BROKEN"}` if Postgres ↔
Fabric divergence is detected (CT-03).

---

## Boot sequence

1. `getDb()` — Postgres.
2. Fabric SDK — connects to `vigil-fabric-peer` via gRPC + crypto-config.
3. `HashChain` for chain-walk consistency.
4. Polls `audit.actions` for unreplicated rows; replays to chaincode.

---

## Health-check signals

| Metric                                                                               | Healthy | Unhealthy → action                            |
| ------------------------------------------------------------------------------------ | ------- | --------------------------------------------- |
| `up{instance=~".*worker-fabric-bridge.*"}`                                           | `1`     | `0` > 2 min → P1                              |
| `vigil_errors_total{service="worker-fabric-bridge", code="AUDIT_HASH_CHAIN_BROKEN"}` | `0`     | `> 0` → P0 (alert: `FabricWitnessDivergence`) |

## SLO signals

| Metric                                                 | SLO target | Investigate-worthy                            |
| ------------------------------------------------------ | ---------- | --------------------------------------------- |
| `vigil_worker_inflight{worker="worker-fabric-bridge"}` | < 50       | > 50 → backlog (alert: `FabricBridgeBacklog`) |
| Replication lag (postgres-seq → fabric)                | < 30 s     | > 5 min → bridge slow                         |

---

## Common failures

| Symptom                                             | Likely cause                                      | Mitigation                                                                        |
| --------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `AUDIT_HASH_CHAIN_BROKEN` from worker-fabric-bridge | Postgres row tampered OR Fabric chaincode bug     | Page architect 24/7. `make verify-cross-witness` to identify; do NOT auto-resync. |
| Backlog > 50 in-flight                              | Fabric peer slow OR network congested             | See [fabric.md](./fabric.md). Bridge auto-resumes when peer healthy.              |
| Bridge stalls on chaincode invoke                   | crypto-config drift (cert renewed without notice) | Re-bootstrap crypto-config; restart bridge.                                       |

---

## R1 — Routine deploy

```sh
docker compose pull worker-fabric-bridge
docker compose up -d worker-fabric-bridge
```

Bridge resumes from last replicated `audit.actions.seq`; no manual
catch-up needed.

## R2 — Restore from backup

Reads `audit.actions` (source of truth) + writes to Fabric
chaincode. After Postgres restore, the bridge replays from
`seq=last_fabric_seq + 1`. Phase-1 scale: catch-up < 10 min.

## R3 — Credential rotation (Phase-2 scaffolded)

Phase-1: single-peer Org1; admin cert is the architect's. No
routine rotation in scope.

Phase-2: per-org admin cert rotation. Procedure fills in at the
multi-org cutover ceremony per [fabric.md R3](./fabric.md).

## R5 — Incident response

| Severity | Trigger                                                                 | Action                                                                                                      |
| -------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **P0**   | `FabricWitnessDivergence` alert (`AUDIT_HASH_CHAIN_BROKEN` from bridge) | Page architect 24/7. STOP bridge. `make verify-cross-witness`. Investigate divergent row before re-syncing. |
| **P1**   | Bridge backlog > 50 sustained > 30 min                                  | Page on-call (alert: `FabricBridgeBacklog`). Investigate Fabric peer health.                                |
| **P2**   | Bridge stalls but Postgres + Polygon witnesses still verify             | Phase-1: tolerable; Fabric is parallel third witness. Schedule fix in next deploy.                          |
| **P3**   | Replication lag creeping up                                             | Investigate gRPC latency.                                                                                   |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md). Fabric
is council-state-blind in Phase 1. Phase-2 multi-org peers don't
correlate to council pillars (different cert lifecycles).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md). The
catch-up replay timing contributes to the 6-h SLA budget.

---

## Cross-references

- [`apps/worker-fabric-bridge/src/`](../../apps/worker-fabric-bridge/src/) — replication loop.
- [`chaincode/audit-witness/`](../../chaincode/audit-witness/) — Fabric chaincode.
- [`docs/runbooks/fabric.md`](./fabric.md) — Fabric peer infra.
- **TRUTH §B.2** — Phase-2 scaffold note.
- **DECISION-004** — permissioned-ledger choice.
- **DECISION-012** — three-witness architecture (Postgres + Polygon + Fabric).
