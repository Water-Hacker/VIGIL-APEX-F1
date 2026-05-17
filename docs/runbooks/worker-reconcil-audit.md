# Runbook — worker-reconcil-audit

> Cross-witness reconciliation loop: walks the tail of `audit.actions`
> hourly, asks the Fabric audit-witness chaincode whether each seq in
> the window agrees on `body_hash`, and emits
> `audit.reconciliation_divergence` (fatal:true) when Postgres ↔
> Fabric disagree. Halts on divergence so no downstream worker
> proceeds against an inconsistent chain.
>
> **Service:** [`apps/worker-reconcil-audit/`](../../apps/worker-reconcil-audit/) — deterministic; no LLM calls.

---

## Description

### 🇫🇷

Worker de réconciliation inter-témoins. Toutes les heures (configurable
via `RECONCIL_AUDIT_INTERVAL_MS`), parcourt les
`RECONCIL_AUDIT_WINDOW_SEQS` dernières seqs de `audit.actions` et
compare chaque `body_hash` Postgres à celui consigné dans la
chaincode Fabric `audit-witness` (via fabric-bridge). En cas
d'accord, n'émet rien. En cas de désaccord, écrit un événement
`audit.reconciliation_divergence` (fatal:true), publie le détail
dans la chaîne d'audit elle-même, et retourne immédiatement de la
boucle — le worker se met en pause silencieuse jusqu'à ce qu'un
opérateur applique le runbook
[audit-chain-divergence.md](audit-chain-divergence.md).

### 🇬🇧

Cross-witness reconciliation worker. Every hour (configurable via
`RECONCIL_AUDIT_INTERVAL_MS`), walks the last
`RECONCIL_AUDIT_WINDOW_SEQS` seqs of `audit.actions` and compares
each Postgres `body_hash` against the corresponding entry in the
Fabric `audit-witness` chaincode (via fabric-bridge). When all
agree, emits nothing. When ANY disagree, writes an
`audit.reconciliation_divergence` event with `fatal:true`,
publishes the detail to the audit chain itself, and returns
immediately from the tick — the worker goes silent until an
operator runs the [audit-chain-divergence.md](audit-chain-divergence.md)
runbook.

---

## Boot sequence

1. `getDb()` — Postgres source.
2. `HashChain` instance against the same Pool.
3. `FabricBridgeClient.connect()` → reads Fabric peer mTLS material from Vault.
4. `LoopBackoff` initialised with `RECONCIL_AUDIT_INTERVAL_MS` (default 1 h).
5. Per-tick worker loop (NOT consumer-group — this worker schedules itself).

---

## Health-check signals

| Metric                                                           | Healthy  | Unhealthy → action                                 |
| ---------------------------------------------------------------- | -------- | -------------------------------------------------- |
| `up{job="vigil-workers", instance=~".*worker-reconcil-audit.*"}` | `1`      | `0` for > 5 min → P1                               |
| `vigil_worker_last_tick_seconds{worker="worker-reconcil-audit"}` | < 75 min | > 90 min → P2                                      |
| `vigil_reconcil_divergence_total`                                | `0`      | any non-zero → P0 (open audit-chain-divergence.md) |

## SLO signals

| Metric                                         | SLO target        | Investigate-worthy                                         |
| ---------------------------------------------- | ----------------- | ---------------------------------------------------------- |
| `vigil_reconcil_window_scanned_total` per tick | == window seqs    | < window → fabric-bridge timing out; check connectivity    |
| `vigil_reconcil_tick_duration_seconds` p99     | < 60 s            | > 5 min → Fabric peer slow; investigate peer health        |
| `vigil_reconcil_republish_total`               | low single digits | climbing → Fabric writes consistently missing → bridge bug |

---

## Common failures

| Symptom                                              | Likely cause                                                      | Mitigation                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `audit.reconciliation_divergence` fires (fatal:true) | Postgres tampering, Fabric tampering, or chaincode replay bug     | **CRITICAL** — follow [audit-chain-divergence.md](audit-chain-divergence.md) step-by-step; do NOT restart the worker until cleared. |
| Worker tick times out repeatedly                     | Fabric peer offline; bridge cannot read chaincode                 | Check fabric-bridge logs; verify peer is up + mTLS material is still valid; fallback path documented in worker-fabric-bridge.md.    |
| Republishes climbing (audit-witness rows missing)    | Fabric chaincode dropped writes (chaincode bug or peer slowness)  | Inspect fabric-bridge dead-letter queue; manually re-submit affected seqs via `make verify-cross-witness --republish`.              |
| Worker silent for > 2 hours                          | `LoopBackoff` saturated on errors OR worker died after divergence | Check `vigil_reconcil_divergence_total` — if > 0, worker is correctly paused; if 0, restart + investigate exit cause.               |

---

## R1 — Routine deploy

```sh
docker compose pull worker-reconcil-audit
docker compose up -d worker-reconcil-audit
```

Watch the first tick complete cleanly before walking away:

```sh
docker compose logs -f worker-reconcil-audit | grep --line-buffered "reconcil-tick"
```

Expected line: `reconcil-tick window_seqs=10000 scanned=N divergent=0 clean=true`.

## R2 — Restore from backup

Stateless (no local disk). Reads from Postgres + Fabric. Resumes
once both upstream restores complete. The first tick after restore
walks the configured window against the restored Fabric chain — if
the restore introduced divergence, this is where it surfaces, so
keep an operator on the channel for the first tick.

## R3 — Credential rotation

- **Postgres**: inherits Vault rotation per [postgres.md](postgres.md) §R3.
- **Fabric peer mTLS**: rotates with the Fabric peer; the bridge
  re-reads `vault.read('fabric/peer/{cert,key}')` on reconnect.
  Coordinate restart with [worker-fabric-bridge.md](worker-fabric-bridge.md) §R3.

## R5 — Incident response

| Severity | Trigger                                                  | Action                                                                                                          |
| -------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **P0**   | `audit.reconciliation_divergence` audit row (fatal:true) | **CRITICAL.** Open [audit-chain-divergence.md](audit-chain-divergence.md). Halt writer fleet.                   |
| **P1**   | Worker down + tick gap > 6 h                             | Page on-call. Reconciliation gap accumulates silently; restart + verify last successful tick range.             |
| **P2**   | Republish rate > 10 / hour                               | Investigate fabric-bridge persistence; chaincode-write retry budget being exhausted.                            |
| **P3**   | Tick duration p99 > 5 min sustained                      | Tune `RECONCIL_AUDIT_WINDOW_SEQS` down OR `RECONCIL_AUDIT_INTERVAL_MS` longer; coordinate with Fabric peer ops. |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md). The
reconciliation worker is not council-touching state.

## R6 — Monthly DR exercise

Critical participant. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md);
the rehearsal exercises a synthetic Fabric divergence and verifies
this worker emits the expected `audit.reconciliation_divergence`
event AND that this runbook's step 3 truth-test
(`packages/audit-chain/src/scripts/recompute-body-hash.ts`)
resolves the source of divergence.

---

## Cross-references

- [`apps/worker-reconcil-audit/src/index.ts`](../../apps/worker-reconcil-audit/src/index.ts) — boot + tick loop.
- [`apps/worker-reconcil-audit/src/reconcile.ts`](../../apps/worker-reconcil-audit/src/reconcile.ts) — Postgres↔Fabric comparison logic.
- [`apps/worker-reconcil-audit/src/republish.ts`](../../apps/worker-reconcil-audit/src/republish.ts) — re-submission path for missing-from-Fabric seqs.
- [audit-chain-divergence.md](audit-chain-divergence.md) — **the** operator response runbook (P0 path).
- [audit-bridge.md](audit-bridge.md) + [worker-fabric-bridge.md](worker-fabric-bridge.md) — Fabric-side helpers.
- [fabric.md](fabric.md) — general Fabric ops.
- **W-11** — Fabric three-witness architecture rationale.
- **CT-03** — cross-witness validation contract per SRD §30.8.
