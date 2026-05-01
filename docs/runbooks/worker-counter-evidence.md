# Runbook — worker-counter-evidence

> Devil's-advocate review on findings at `posterior >= 0.85`.
> Routes through SafeLlmRouter (DECISION-011). Writes the
> counter-evidence narrative to `finding.counter_evidence`.
>
> **Service:** [`apps/worker-counter-evidence/`](../../apps/worker-counter-evidence/) — LLM-using; SafeLlmRouter chokepoint.

---

## Description

### 🇫🇷

Revue contradictoire pour les findings éligibles à escalade
(posterior ≥ 0.85). Routé via `SafeLlmRouter.call({findingId,
assessmentId, promptName: 'counter-evidence.devils-advocate-narrative',
...})`. Le prompt cherche les raisons pour lesquelles le finding
pourrait être faux. La sortie est stockée dans
`finding.counter_evidence` ; le finding passe en `state='review'`.

### 🇬🇧

Adversarial review for findings eligible for escalation
(posterior ≥ 0.85). Routes through `SafeLlmRouter.call({findingId,
assessmentId, promptName: 'counter-evidence.devils-advocate-narrative',
...})`. The prompt seeks reasons the finding might be wrong. The
output is stored in `finding.counter_evidence`; the finding moves
to `state='review'`.

---

## Boot sequence

1. `LlmRouter` instantiated, `SafeLlmRouter` wraps it (DECISION-011).
2. `Safety.adversarialPromptsRegistered()` — refuse to start if missing.
3. `CallRecordRepo` wired as the SafeLlmRouter sink.
4. Consumer-group on `vigil:counter:evidence`.

---

## Health-check signals

| Metric                                                             | Healthy | Unhealthy → action |
| ------------------------------------------------------------------ | ------- | ------------------ |
| `up{instance=~".*worker-counter-evidence.*"}`                      | `1`     | `0` > 2 min → P0   |
| `vigil_worker_last_tick_seconds{worker="worker-counter-evidence"}` | < 1 h   | > 1 h → P1         |

## SLO signals

| Metric                                                              | SLO target | Investigate-worthy            |
| ------------------------------------------------------------------- | ---------- | ----------------------------- |
| Counter-evidence latency p99                                        | < 30 s     | > 60 s → LLM slow             |
| `vigil_llm_calls_total{provider="anthropic", outcome="error"}` rate | < 1/min    | > 5/min → LLM provider issues |

---

## Common failures

| Symptom                                          | Likely cause                                            | Mitigation                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `safe-router: response failed schema validation` | LLM emitted malformed JSON                              | Retry; if persistent, audit prompt drift in registry vs source.                                 |
| `LlmCircuitOpenError` from anthropic             | Tier-0 circuit breaker tripped                          | Tier-1 Bedrock failover should kick in; verify `vigil_llm_calls_total{provider="bedrock"}` > 0. |
| `LlmCostCeilingError` daily ceiling              | finding count × counter-evidence cost exceeded $100/day | Operator decision required; halt or bump ceiling.                                               |
| `LlmPricingNotConfiguredError`                   | model_id swap without pricing.json update               | Update `infra/llm/pricing.json` per Block-A A.4.                                                |

---

## R1 — Routine deploy

```sh
docker compose pull worker-counter-evidence
docker compose up -d worker-counter-evidence
```

## R2 — Restore from backup

Reads `finding.finding` + writes `finding.counter_evidence`. Both
in Postgres.

## R3 — Credential rotation

`anthropic/api_key` rotation:

```sh
# 1. Architect rotates the Anthropic API key out-of-band.
# 2. Update Vault:
vault kv put secret/anthropic api_key=<new>
# 3. Restart worker so it re-reads on boot:
docker compose restart worker-counter-evidence
# 4. Verify next safe.call writes to llm.call_record (post-restart row).
```

The cost-tracker is in-process; restart resets daily-spend counter
to zero. Watch `vigil_llm_cost_usd_total` for the first 24 h post-
rotation to confirm pre-rotation rate continues.

LLM-using workers SHARE the same `anthropic/api_key` Vault path.
Rotation is coordinated across all of them: worker-counter-evidence,
worker-extractor, worker-entity, worker-tip-triage,
worker-adapter-repair, worker-dossier (narrative), worker-conac-sftp
(narrative path).

## R5 — Incident response

| Severity | Trigger                                                    | Action                                                                              |
| -------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **P1**   | Anthropic API rate-limit exceeded with no Bedrock failover | Page on-call. Counter-evidence is spec-blocking for action_queue; escalation halts. |
| **P1**   | `LlmCostCeilingError` (daily hard ceiling)                 | Page architect. Operator decision: halt vs bump.                                    |
| **P2**   | Counter-evidence latency > 60 s sustained                  | Investigate provider; consider Tier-1 Bedrock pre-emptive failover.                 |
| **P3**   | One finding's counter-evidence schema-rejected repeatedly  | Inspect; possible prompt-version drift.                                             |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).

---

## Cross-references

- [`apps/worker-counter-evidence/src/index.ts`](../../apps/worker-counter-evidence/src/index.ts) — SafeLlmRouter call.
- [`apps/worker-counter-evidence/src/prompts.ts`](../../apps/worker-counter-evidence/src/prompts.ts) — registered prompt.
- [`packages/llm/src/safe-router.ts`](../../packages/llm/src/safe-router.ts) — chokepoint.
- **DECISION-011** — AI-Safety doctrine.
- **SRD §19.6** — counter-evidence threshold (0.85).
- **HSK-v1 §6** — credential rotation cadence.
