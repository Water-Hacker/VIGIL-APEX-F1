# Runbook — fabric (vigil-fabric-peer)

> Infra-plane service. Phase-2 scaffolded per TRUTH §B.2; not
> running in steady state through Phase 1. Hyperledger Fabric 2.5
> single-peer witness for the audit chain.
>
> **Service:** docker-compose service `vigil-fabric-peer` +
> companion orderer/CA. Postgres `audit.actions` remains the source
> of truth in MVP; Fabric is a parallel cryptographic witness only.

---

## Description

### 🇫🇷

Témoin permissionné de la chaîne d'audit. Phase-2 scaffolded —
single-peer en Phase 1 ; multi-organisation (CONAC, Cour des
Comptes) à l'entrée de Phase 2 par extension de
`crypto-config.yaml`. Le worker `apps/worker-fabric-bridge`
réplique chaque entrée Postgres `audit.actions` vers le chaincode
`audit-witness`. Le chaincode stocke seulement (seq, body_hash,
recordedAt) — pas le payload.

### 🇬🇧

Permissioned audit-chain witness. Phase-2 scaffolded — single-peer
in Phase 1; multi-org (CONAC, Cour des Comptes) at Phase-2 entry
by extending `crypto-config.yaml`. The `apps/worker-fabric-bridge`
worker replicates each Postgres `audit.actions` entry to the
`audit-witness` chaincode. Chaincode stores only (seq, body_hash,
recordedAt) — not the payload.

---

## Boot sequence (Phase 1 single-peer)

1. Docker compose pulls `hyperledger/fabric-peer` + orderer + CA.
2. crypto-config bootstrapped from
   [`chaincode/audit-witness/crypto-config.yaml`](../../chaincode/audit-witness/) (Org1 only in Phase 1).
3. Channel `vigil-audit` created on first boot.
4. Chaincode `audit-witness` instantiated.
5. `worker-fabric-bridge` connects via the Fabric SDK; starts
   replicating `audit.actions` rows on a continuous loop.

---

## Health-check signals

| Metric                                                                               | Healthy | Unhealthy → action                                               |
| ------------------------------------------------------------------------------------ | ------- | ---------------------------------------------------------------- |
| Docker healthcheck `vigil-fabric-peer`                                               | OK      | failing > 60 s → P2 (witness only; Postgres still authoritative) |
| `vigil_fabric_replication_lag_seconds`                                               | < 60 s  | > 5 min → CT-03 cross-witness drift starts emitting              |
| `vigil_errors_total{service="worker-fabric-bridge", code="AUDIT_HASH_CHAIN_BROKEN"}` | 0       | > 0 → page architect (Fabric witness diverged from Postgres)     |

## SLO signals

| Metric                             | SLO target | Investigate-worthy                            |
| ---------------------------------- | ---------- | --------------------------------------------- |
| Replication lag p99                | < 30 s     | > 2 min → worker-fabric-bridge falling behind |
| Disk usage on Fabric ledger volume | < 70 %     | > 85 % → archive old blocks                   |

---

## Common failures

| Symptom                                        | Likely cause                                          | Mitigation                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `worker-fabric-bridge` logs Fabric SDK timeout | peer down or orderer down                             | `docker compose logs vigil-fabric-peer --tail=200`; restart peer + orderer.                         |
| `AUDIT_HASH_CHAIN_BROKEN` emitted              | Fabric witness diverged from Postgres `audit.actions` | Page architect 24/7. Consult `make verify-cross-witness`; investigate root cause before re-syncing. |
| Channel-creation fails on first boot           | crypto-config drift                                   | Inspect `chaincode/audit-witness/crypto-config.yaml`; regenerate certs if needed.                   |

---

## R1 — Routine deploy

Phase-1: rare (single-peer; image bumps only). Phase-2 entry adds
multi-org which has its own deploy procedure.

```sh
docker compose pull vigil-fabric-peer
docker compose up -d vigil-fabric-peer vigil-fabric-orderer vigil-fabric-ca
```

Verify `worker-fabric-bridge` resumes replication within 60 s.

---

## R2 — Restore from backup

Phase-1: Fabric ledger is **rebuildable from Postgres** —
`worker-fabric-bridge` re-replicates every `audit.actions` row
from `seq=1`. Restore procedure:

1. Bring vigil-fabric-\* services up fresh.
2. `worker-fabric-bridge` detects empty channel and replays from
   beginning. Replay throughput at Phase-1 scale (~10k audit rows)
   completes in < 10 min.

Phase-2: with multi-org peers, the leader peer's ledger is
authoritative; follower peers catch up via gossip.

---

## R3 — Credential rotation (Phase-2 scaffolded note)

Fabric MSP credential rotation is a Phase-2 ceremony:

- New CA-signed peer certs issued.
- Each org rotates its admin cert.
- Channel update transaction signed by current admin certs.

Phase-1 single-peer: no rotation in scope. The peer's bootstrap
identity is the architect's Org1 admin cert; rotation is deferred
until the multi-org cutover (per TRUTH §B.2).

When Phase-2 entry happens, R3 fills in with the actual rotation
procedure + EXEC §17 cross-ref.

---

## R5 — Incident response

| Severity | Trigger                                                     | Action                                                                                                                                   |
| -------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**   | `AUDIT_HASH_CHAIN_BROKEN` emitted by `worker-fabric-bridge` | Page architect 24/7. Stop `worker-fabric-bridge`. `make verify-cross-witness` to identify divergent rows. Investigate before re-syncing. |
| **P1**   | Fabric peer down > 30 min                                   | Page on-call. Postgres + Polygon witnesses cover the chain; Fabric is a parallel third witness.                                          |
| **P2**   | Replication lag > 5 min                                     | Investigate `worker-fabric-bridge` consumer; check peer health.                                                                          |
| **P3**   | Disk usage > 85 %                                           | Archive old blocks per Fabric admin guide.                                                                                               |

---

## R4 — Council pillar rotation

N/A in Phase 1 (single-peer Org1 admin = architect). Phase-2
multi-org: the CONAC + Cour des Comptes peers have their own admin
cert lifecycles; not coupled to council pillar rotation. See
[R4-council-rotation.md](./R4-council-rotation.md) for the application
half.

## R6 — Monthly DR exercise

Phase-1: included only as a worker-fabric-bridge replay test.
Phase-2: full multi-org ledger replay scenario.

---

## Cross-references

### Code

- [`chaincode/audit-witness/`](../../chaincode/audit-witness/) — Fabric chaincode.
- [`apps/worker-fabric-bridge/`](../../apps/worker-fabric-bridge/) — Postgres → Fabric replicator.

### Binding spec

- **TRUTH §B.2** — Phase-2 scaffold note; Postgres remains source of truth in MVP.
- **SRD §17.4** — three-witness architecture (Postgres + Polygon + Fabric).
- **DECISION-004** — permissioned-ledger choice for MVP.
- **DECISION-012 / TAL-PA** — audit chain doctrine (Fabric as parallel witness).
