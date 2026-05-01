# Runbook — worker-pattern

> Pattern dispatcher. Consumes `vigil:pattern:detect`; loads
> subject + 1-hop graph + recent events; runs the 43 patterns;
> writes signals to `finding.signal`.
>
> **Service:** [`apps/worker-pattern/`](../../apps/worker-pattern/) — deterministic dispatcher; no LLM calls.

---

## Description

### 🇫🇷

Dispatcher de motifs. Consomme `vigil:pattern:detect` (émis par
worker-entity et worker-extractor). Charge le canonical_id, ses
voisins de premier niveau (Postgres + Neo4j), les événements
récents, les findings antérieurs. Exécute les 43 motifs
applicables au `subject_kind`. Écrit chaque signal dans
`finding.signal` ; émet `vigil:score:compute` pour worker-score.

### 🇬🇧

Pattern dispatcher. Consumes `vigil:pattern:detect` (emitted by
worker-entity and worker-extractor). Loads canonical_id, 1-hop
neighbours (Postgres + Neo4j), recent events, prior findings.
Runs the 43 patterns applicable to the `subject_kind`. Writes
each signal to `finding.signal`; emits `vigil:score:compute` for
worker-score.

---

## Boot sequence

1. `Neo4jClient.connect()` — graph-side neighbour lookup.
2. `getDb()` — Postgres source.
3. `EntityRepo` + `FindingRepo` + `SourceRepo`.
4. `registerAllPatterns()` from `_register-patterns.ts` — 43 patterns into the registry.
5. Consumer-group on `vigil:pattern:detect`.

---

## Health-check signals

| Metric                                                    | Healthy | Unhealthy → action   |
| --------------------------------------------------------- | ------- | -------------------- |
| `up{job="vigil-workers", instance=~".*worker-pattern.*"}` | `1`     | `0` for > 2 min → P0 |
| `vigil_worker_last_tick_seconds{worker="worker-pattern"}` | < 1 h   | > 1 h → P1           |

## SLO signals

| Metric                                            | SLO target        | Investigate-worthy                                   |
| ------------------------------------------------- | ----------------- | ---------------------------------------------------- |
| `vigil_worker_inflight{worker="worker-pattern"}`  | ≤ concurrency (6) | sustained at ceiling > 10 min → saturation           |
| `vigil_pattern_eval_duration_ms` p99 per pattern  | < 1 s             | > 5 s for any pattern_id → that pattern's logic slow |
| `vigil_pattern_strength` distribution per pattern | bimodal           | drift to always-high → false-positive review needed  |

---

## Common failures

| Symptom                                                   | Likely cause                                          | Mitigation                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Pattern dispatch error in logs                            | pattern code throws (bug in detector)                 | Inspect logs by `pattern_id`; downgrade pattern to `status: shadow` until fixed. |
| `vigil_pattern_eval_duration_ms` p99 > 5 s on one pattern | inefficient detector OR Neo4j slow                    | Profile; reduce graph-traversal scope OR fix Neo4j indexes.                      |
| Empty `subject` from worker-entity                        | A.4 fix regression — caller publishing empty envelope | Audit worker-entity dispatch; confirm `canonical_id` non-null.                   |

---

## R1 — Routine deploy

```sh
docker compose pull worker-pattern
docker compose up -d worker-pattern
```

## R2 — Restore from backup

Reads from Postgres + Neo4j; no local state. Resumes after both
upstream restores complete.

## R3 — Credential rotation

N/A — service has no rotatable external credential. Inherits
postgres + neo4j + redis credentials via Vault (rotation lives in
those infra runbooks).

## R5 — Incident response

| Severity | Trigger                                     | Action                                                                              |
| -------- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| **P1**   | Worker down + PEL backlog > 1000            | Page on-call. Pattern dispatch is upstream of escalation; backlog risks SLA breach. |
| **P2**   | Single pattern always-firing (drift)        | Review fixture coverage + LR reasoning per `docs/patterns/<P-X-NNN>.md`.            |
| **P2**   | Pattern eval p99 > 5 s sustained            | Profile detector; consider Neo4j index hints.                                       |
| **P3**   | One pattern's status flipping shadow ↔ live | Audit governance for the pattern's calibration band per AUDIT-097.                  |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).

---

## Cross-references

- [`apps/worker-pattern/src/index.ts`](../../apps/worker-pattern/src/index.ts) — handler + dispatch.
- [`packages/patterns/src/`](../../packages/patterns/src/) — 43 PatternDef files.
- [`packages/patterns/test/`](../../packages/patterns/test/) — fixture suites.
- **SRD §21** — pattern catalogue + categories.
- **AUDIT-097** — pattern weights registry.
