# Runbook — worker-score

> Bayesian certainty engine. Reads `finding.signal`, runs the
> 3-tier dispatch (action / investigation / log_only), writes
> `certainty.assessment`, sets posterior on `finding.finding`.
>
> **Service:** [`apps/worker-score/`](../../apps/worker-score/) — deterministic engine + adversarial counterfactual probe.

---

## Description

### 🇫🇷

Moteur de certitude bayésien (DECISION-011). Pour chaque
`finding_id` reçu, lit tous les `finding.signal` (filtrés par
`contributed_at <= NOW()` per Block-A A.5), passe par
`assessFinding`, écrit l'`certainty.assessment`, met à jour
`finding.posterior`. Sur `tier='action_queue'`, émet
`vigil:counter:evidence` pour worker-counter-evidence.

### 🇬🇧

Bayesian certainty engine (DECISION-011). Per `finding_id`, reads
all `finding.signal` rows (filtered by `contributed_at <= NOW()`
per Block-A A.5), runs `assessFinding`, writes the
`certainty.assessment`, updates `finding.posterior`. On
`tier='action_queue'`, emits `vigil:counter:evidence` for
worker-counter-evidence.

---

## Boot sequence

1. `loadRegistries()` — independence + likelihood-ratio CSVs from `infra/certainty/`.
2. `getDb()` — Postgres.
3. `FindingRepo` + `CertaintyRepo`.
4. Consumer-group on `vigil:score:compute`.
5. Note: worker-score itself does NOT call Claude — the
   counterfactual probe is deterministic. Adversarial pipeline
   (devil's advocate, secondary review) lives in
   worker-counter-evidence.

---

## Health-check signals

| Metric                                                  | Healthy | Unhealthy → action   |
| ------------------------------------------------------- | ------- | -------------------- |
| `up{instance=~".*worker-score.*"}`                      | `1`     | `0` for > 2 min → P0 |
| `vigil_worker_last_tick_seconds{worker="worker-score"}` | < 1 h   | > 1 h → P1           |

## SLO signals

| Metric                                 | SLO target | Investigate-worthy                                           |
| -------------------------------------- | ---------- | ------------------------------------------------------------ |
| `vigil_finding_posterior` distribution | bimodal    | drift to always-high → engine miscalibrated; ECE alert fires |
| `vigil_calibration_ece_overall`        | < 0.05     | > 0.10 → page on-call (alert: `ECEHigh`)                     |
| Score-loop duration p99                | < 2 s      | > 10 s → certainty engine slow                               |

---

## Common failures

| Symptom                                           | Likely cause                               | Mitigation                                                                  |
| ------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| `ECEHigh` alert                                   | engine miscalibrated against ground truth  | Architect runs quarterly calibration audit per AI-SAFETY-DOCTRINE-v1 §A.6.  |
| Worker logs `signal-row contributed_at in future` | adapter wrote a backdated/future-timed row | Block-A A.5 filter rejects at read time; investigate adapter that wrote it. |
| Score loop slow                                   | certainty registry CSVs not cached         | Verify `loadRegistries()` ran once; bump registry-cache TTL.                |

---

## R1 — Routine deploy

```sh
docker compose pull worker-score
docker compose up -d worker-score
```

## R2 — Restore from backup

Reads `finding.signal` + writes `certainty.assessment` — both in
Postgres. No local state.

## R3 — Credential rotation

N/A — no service-specific credential. Postgres + Redis creds rotate
via [postgres.md R3](./postgres.md) and [redis.md R3](./redis.md).
worker-score does NOT call Claude directly; the LLM-credential
rotation that affects worker-counter-evidence cascades through the
shared `anthropic/api_key` Vault path (rotation procedure in
[worker-counter-evidence.md R3](./worker-counter-evidence.md)).

## R5 — Incident response

| Severity | Trigger                                         | Action                                                                                |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| **P0**   | `ECEHigh > 0.15` (calibration broken)           | Page architect 24/7. Halt action_queue dispatch until calibration audit completes.    |
| **P1**   | Worker down + score backlog                     | Page on-call. Findings stuck in `detected` state; review queue empty.                 |
| **P2**   | Posterior drift (engine writing high-band only) | Investigate signal corpus; verify backdated-signal filter still active (Block-A A.5). |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md). Score
recompute from `finding.signal` is fast (deterministic; no LLM).

---

## Cross-references

- [`apps/worker-score/src/index.ts`](../../apps/worker-score/src/index.ts) — handler.
- [`packages/certainty-engine/`](../../packages/certainty-engine/) — assessFinding logic.
- [`infra/certainty/`](../../infra/certainty/) — independence-weights.json + likelihood-ratios.csv.
- **SRD §19, §28** — Bayesian engine + escalation thresholds.
- **DECISION-011** — AI-Safety doctrine (3-tier dispatch).
- **Block-A A.5** — backdated-signal filter + dead-query removal (commit `c3359b0`).
