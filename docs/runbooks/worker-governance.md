# Runbook — worker-governance

> Council vote tally + recusal + escalation trigger. Touches
> council state directly — **owns the per-worker R4 content**.
>
> **Service:** [`apps/worker-governance/`](../../apps/worker-governance/) — Postgres-only (no LLM); council quorum logic.

---

## Description

### 🇫🇷

Tally les votes du conseil sur les propositions ouvertes ; calcule
quorum 3-of-5 (escalade) / 4-of-5 (publication publique) per
SRD §28. Gère récusation (CouncilMemberConflictError) et
auto-archivage à 14 jours. Émet `vigil:dossier:render` sur escalade
approuvée. Lit `governance.proposal_vote` + `governance.council_member`.

### 🇬🇧

Tallies council votes on open proposals; computes 3-of-5 (escalation)
/ 4-of-5 (public release) quorum per SRD §28. Handles recusal
(`CouncilMemberConflictError`) and 14-day auto-archive. Emits
`vigil:dossier:render` on approved escalation. Reads
`governance.proposal_vote` + `governance.council_member`.

---

## Boot sequence

1. `getDb()` — Postgres.
2. `GovernanceRepo` + `FindingRepo`.
3. Consumer-group on `vigil:governance:tally` + cron tick for the
   14-day archive sweep.

---

## Health-check signals

| Metric                                                       | Healthy | Unhealthy → action |
| ------------------------------------------------------------ | ------- | ------------------ |
| `up{instance=~".*worker-governance.*"}`                      | `1`     | `0` > 2 min → P0   |
| `vigil_worker_last_tick_seconds{worker="worker-governance"}` | < 1 h   | > 1 h → P1         |

## SLO signals

| Metric                                          | SLO target              | Investigate-worthy                            |
| ----------------------------------------------- | ----------------------- | --------------------------------------------- |
| `vigil_council_vote_total{choice}` distribution | balanced YES/NO/ABSTAIN | drift to all-YES → review pillar independence |
| Tally latency p99                               | < 500 ms                | > 2 s → quorum SQL slow                       |
| Auto-archive lag (14-day window)                | < 1 h past 14d expiry   | > 4 h → cron tick stalled                     |

---

## Common failures

| Symptom                                 | Likely cause                                      | Mitigation                                                                 |
| --------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| Quorum not met but votes look complete  | recused vote counted incorrectly                  | Inspect `governance.proposal_vote.choice = 'RECUSE'` filter logic.         |
| `QuorumNotMetError` despite 3 YES votes | one of the YES votes was from a terminated pillar | Check `governance.council_member.terminated_at`; vote must be from active. |
| Stuck-open proposal past 14 days        | auto-archive cron tick missed                     | Manual archive via SQL OR trigger cron; investigate cron scheduler health. |

---

## R1 — Routine deploy

```sh
docker compose pull worker-governance
docker compose up -d worker-governance
```

## R2 — Restore from backup

Reads + writes `governance.*` tables in Postgres. No local state.

## R3 — Credential rotation

N/A — no service-specific credential. Postgres + Redis creds rotate
via [postgres.md R3](./postgres.md) and [redis.md R3](./redis.md).

## R4 — Council pillar rotation

**Full content here.** worker-governance is the application-state
owner of council membership. The rotation ceremony (canonical at
[R4-council-rotation.md](./R4-council-rotation.md)) writes via the
dashboard council admin surface, but the consequences fan out
through worker-governance:

1. Old pillar's `terminated_at` set → worker-governance's quorum
   queries exclude that pillar from the next tally.
2. New pillar's row inserted → next tally includes them.
3. Audit emit (`governance.pillar_terminated` +
   `governance.pillar_appointed`) flows through audit-bridge → worker-anchor
   high-sig fast-lane.

If the rotation drops active count below 5 (mid-ceremony), the
`worker-governance` quorum check refuses to record any
pillar-affecting decision until count returns to 5. Operator-side
this surfaces as `QuorumNotMetError` with a clear message.

Recusal-vs-rotation distinction: a single-incident recusal is a
vote-time `RECUSE` choice (handled inline by tally logic). A
permanent recusal triggers R4 (rotation).

## R5 — Incident response

| Severity | Trigger                                           | Action                                                                              |
| -------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **P0**   | Active pillar count < 5 mid-vote-window           | Page architect 24/7. Quorum impossible; finalise R4 to restore count.               |
| **P1**   | Worker down + open proposals near 14-day boundary | Page on-call. Auto-archive may miss; manual intervention.                           |
| **P2**   | Quorum miscalculation (vote-counting bug)         | Page architect. Halt worker-governance; investigate; do not auto-correct decisions. |
| **P3**   | Auto-archive lag > 4 h                            | Cron tick triage.                                                                   |

## R6 — Monthly DR exercise

Critical. The R6 rehearsal includes a simulated council vote +
escalation path; worker-governance must restart and resume tally.

---

## Cross-references

- [`apps/worker-governance/src/index.ts`](../../apps/worker-governance/src/index.ts) — quorum tally + recusal.
- [`packages/db-postgres/src/repos/governance.ts`](../../packages/db-postgres/src/repos/governance.ts) — `GovernanceRepo`.
- [`docs/runbooks/R4-council-rotation.md`](./R4-council-rotation.md) — system-wide ceremony.
- **SRD §23** — Council.
- **SRD §28** — quorum thresholds.
- **EXEC §08–§14** — pillar formation.
- **DECISION-012** / TAL-PA — `governance.pillar_*` event types.
