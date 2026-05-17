# Runbook — worker-outcome-feedback

> Closes the calibration loop: consumes `vigil:outcome:signal` and
> matches each operational signal (CONAC publication, Cour des
> Comptes disposition, council vote outcome, sentinel detection of
> a true/false positive) back to the originating finding so the
> calibration table tracks reliability over time.
>
> **Service:** [`apps/worker-outcome-feedback/`](../../apps/worker-outcome-feedback/) — deterministic matcher; no LLM calls.

---

## Description

### 🇫🇷

Worker de rétroaction. Consomme `vigil:outcome:signal` (publié par
worker-conac-sftp, worker-governance, worker-audit-watch quand un
signal opérationnel confirme ou infirme un finding). Apparie le
signal au finding source (matching exact sur `finding_id` ou par
fenêtre temporelle + `subject_id` quand `finding_id` absent),
écrit le résultat dans `calibration.entry`, et émet
`vigil:calibration:report` pour le worker de reporting hebdomadaire.

### 🇬🇧

Outcome-feedback worker. Consumes `vigil:outcome:signal` (emitted
by worker-conac-sftp, worker-governance, worker-audit-watch when
an operational signal confirms or refutes a finding). Matches the
signal to its source finding (exact `finding_id` when present;
temporal-window + `subject_id` fallback when not), writes the
result to `calibration.entry`, and emits `vigil:calibration:report`
for the weekly reporting worker.

---

## Boot sequence

1. `getDb()` — Postgres source.
2. `FindingRepo` + `CalibrationRepo`.
3. Consumer-group on `STREAMS.OUTCOME_SIGNAL`.

---

## Health-check signals

| Metric                                                             | Healthy | Unhealthy → action   |
| ------------------------------------------------------------------ | ------- | -------------------- |
| `up{job="vigil-workers", instance=~".*worker-outcome-feedback.*"}` | `1`     | `0` for > 5 min → P1 |
| `vigil_worker_last_tick_seconds{worker="worker-outcome-feedback"}` | < 24 h  | > 24 h → P2          |

## SLO signals

| Metric                                                 | SLO target                  | Investigate-worthy                                 |
| ------------------------------------------------------ | --------------------------- | -------------------------------------------------- |
| `vigil_outcome_match_rate{strategy="exact"}`           | > 80 %                      | < 60 % → upstream publishers dropping `finding_id` |
| `vigil_outcome_match_rate{strategy="temporal-window"}` | 5–20 %                      | > 40 % → exact-match channel broken                |
| `vigil_calibration_entries_total` weekly delta         | > 1 per week (post-Phase-1) | 0 for 14 days → no operational signal landing      |

---

## Common failures

| Symptom                                     | Likely cause                                                            | Mitigation                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Unmatched signals piling up in DLQ          | Publisher emitting wrong subject_kind / subject_id shape                | Inspect DLQ rows; cross-reference upstream worker's `audit.actions` for the publish event. |
| `calibration.entry` writes silently failing | Schema drift between OUTCOME_SIGNAL envelope and the CalibrationRepo    | Check recent migrations + verify Zod schema at handler.ts boundary; bump schema_version.   |
| Exact-match rate dropping                   | Upstream worker (e.g. worker-conac-sftp) stopped propagating finding_id | Audit the publishing worker's envelope-builder; the matcher cannot conjure missing IDs.    |

---

## R1 — Routine deploy

```sh
docker compose pull worker-outcome-feedback
docker compose up -d worker-outcome-feedback
```

## R2 — Restore from backup

Stateless w.r.t. local disk; reads from Postgres only. Resumes
after Postgres restore completes per [backup.md](backup.md) §3.

## R3 — Credential rotation

N/A — service has no rotatable external credential. Inherits
postgres + redis credentials via Vault (rotation in
[postgres.md](postgres.md) §R3 + [redis.md](redis.md) §R3).

## R5 — Incident response

| Severity | Trigger                                                     | Action                                                                                         |
| -------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **P1**   | Worker down + PEL backlog > 1000                            | Page on-call. Calibration drift accumulates silently until matching resumes.                   |
| **P2**   | `vigil_outcome_match_rate{strategy="exact"}` < 60 % for 6 h | Inspect upstream publishers; the matcher reports drift, doesn't cause it.                      |
| **P2**   | Calibration entries 0 for 14 days                           | Verify operational signal sources (CONAC SFTP confirmations, council votes, sentinel matches). |
| **P3**   | Temporal-window matcher false-positive rate climbing        | Tighten window OR require finding_id at upstream; calibration entry is the source of truth.    |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).

---

## Cross-references

- [`apps/worker-outcome-feedback/src/index.ts`](../../apps/worker-outcome-feedback/src/index.ts) — boot + consumer wiring.
- [`apps/worker-outcome-feedback/src/handler.ts`](../../apps/worker-outcome-feedback/src/handler.ts) — match-and-persist logic.
- [`apps/worker-outcome-feedback/src/outcome-matching.ts`](../../apps/worker-outcome-feedback/src/outcome-matching.ts) — exact + temporal-window matcher.
- **SRD §19.5** — calibration loop + ECE/Brier scoring.
- **W-16** — calibration seed precondition (architect-blocked, deferred to M2 exit).
