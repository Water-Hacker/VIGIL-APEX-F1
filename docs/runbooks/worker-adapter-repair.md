# Runbook — worker-adapter-repair

> Adapter-selector re-derivation. When a source page changes shape
> and an adapter goes `first_contact_failed`, this worker uses
> SafeLlmRouter to propose a new selector; shadow-tests it; promotes
> on success. Block-B B.4 SafeLlmRouter migration (commit `10dac28`).
>
> **Service:** [`apps/worker-adapter-repair/`](../../apps/worker-adapter-repair/) — LLM-using; adapter recovery.

---

## Description

### 🇫🇷

Réparation automatique des adaptateurs cassés. Cron quotidien
(03:00 Africa/Douala) : pour chaque adaptateur en
`first_contact_failed`, télécharge l'archive HTML d'origine + la
page actuelle, appelle `SafeLlmRouter.call({promptName:
'adapter-repair.selector-rederive', ...})` pour proposer un nouveau
sélecteur (CSS / XPath / json_path). Cron horaire : runShadowTest
sur chaque proposition pendant 48 fenêtres ; maybePromote sur
succès.

### 🇬🇧

Automatic adapter repair. Daily cron (03:00 Africa/Douala): for
each `first_contact_failed` adapter, fetches the original HTML
archive + the current page, calls `SafeLlmRouter.call({promptName:
'adapter-repair.selector-rederive', ...})` to propose a new
selector (CSS / XPath / json_path). Hourly cron: runShadowTest on
each proposal across 48 windows; maybePromote on success.

---

## Boot sequence

1. `LlmRouter` + `SafeLlmRouter` (DECISION-011).
2. `Safety.adversarialPromptsRegistered()`.
3. `CallRecordRepo` sink wired.
4. Two cron schedules: daily 03:00 + hourly.

---

## Health-check signals

| Metric                                      | Healthy | Unhealthy → action |
| ------------------------------------------- | ------- | ------------------ |
| `up{instance=~".*worker-adapter-repair.*"}` | `1`     | `0` > 2 min → P2   |
| Cron tick logs (`daily-repair-sweep-start`) | nightly | absent > 25 h → P1 |

## SLO signals

| Metric                      | SLO target                  | Investigate-worthy                          |
| --------------------------- | --------------------------- | ------------------------------------------- |
| Proposal generation rate    | matches broken-adapter rate | flat with broken adapters → cron not firing |
| `maybePromote` success rate | > 50 %                      | < 25 % → LLM proposing bad selectors        |

---

## Common failures

| Symptom                                | Likely cause                                          | Mitigation                                                                      |
| -------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| Daily cron didn't fire                 | container restarted past 03:00; cron inside container | Restart with sufficient lead time before 03:00 Africa/Douala.                   |
| LLM proposes selector matching nothing | new HTML structurally different                       | LLM sets `selector: null` per prompt contract; operator manual repair required. |
| Shadow test always fails               | candidate selector wrong                              | Iterate proposal; if 3 windows fail, mark proposal `rejected` and re-prompt.    |

---

## R1 — Routine deploy

```sh
docker compose pull worker-adapter-repair
docker compose up -d worker-adapter-repair
```

Daily cron resumes at next 03:00.

## R2 — Restore from backup

Reads `source.adapter_health` + `source.adapter_repair_proposal`,
writes proposals + shadow-test results. No local state.

## R3 — Credential rotation

`anthropic/api_key` rotation per
[worker-counter-evidence.md R3](./worker-counter-evidence.md). The
selector-rederive call is the only LLM use.

## R5 — Incident response

| Severity | Trigger                                                                               | Action                                                     |
| -------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **P1**   | Critical adapter (`anif-amlscreen`/`minfi-bis`) broken with no auto-repair after 48 h | Page architect. Manual selector repair + MOU coordination. |
| **P2**   | LLM error rate on selector-rederive > 5/hour                                          | Investigate provider; consider Tier-1 failover.            |
| **P3**   | Daily cron skipped                                                                    | Operator triage; trigger manual sweep.                     |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).

---

## Cross-references

- [`apps/worker-adapter-repair/src/index.ts`](../../apps/worker-adapter-repair/src/index.ts) — cron + SafeLlmRouter.
- [`apps/worker-adapter-repair/src/prompts.ts`](../../apps/worker-adapter-repair/src/prompts.ts) — registered prompt.
- [`apps/worker-adapter-repair/__tests__/safe-call.test.ts`](../../apps/worker-adapter-repair/__tests__/safe-call.test.ts) — Block-B A2 doctrine-surface regression.
- **DECISION-011** — AI-Safety doctrine.
- **Block-B A2** — SafeLlmRouter migration (commit `10dac28`).
