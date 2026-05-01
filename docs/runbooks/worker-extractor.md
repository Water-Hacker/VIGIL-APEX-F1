# Runbook — worker-extractor

> Source-event field extractor. Rule-pass + LLM-pass via
> `SafeLlmExtractor` (which wraps SafeLlmRouter).
>
> **Service:** [`apps/worker-extractor/`](../../apps/worker-extractor/) — LLM-using; SafeLlmExtractor adapter.

---

## Description

### 🇫🇷

Extrait les champs structurés (montants, dates, attributaire,
RCCM…) à partir de chaque `source.event`. D'abord rule-based ;
les champs non couverts passent par `SafeLlmExtractor` qui
appelle `SafeLlmRouter.call({promptName: 'procurement.extract-fields',
...})` avec citation verbatim obligatoire (L1 + L8). Émet
`vigil:entity:resolve` pour worker-entity.

### 🇬🇧

Extracts structured fields (amounts, dates, awardee, RCCM…) from
each `source.event`. Rule-based first; uncovered fields pass through
`SafeLlmExtractor` which calls `SafeLlmRouter.call({promptName:
'procurement.extract-fields', ...})` with mandatory verbatim
citation (L1 + L8). Emits `vigil:entity:resolve` for worker-entity.

---

## Boot sequence

1. `LlmRouter` instantiated, then `SafeLlmRouter` wraps it.
2. `SafeLlmExtractor` constructed with the safe-router adapter.
3. `Safety.adversarialPromptsRegistered()` check.
4. Consumer-group on `vigil:extract:fields`.

---

## Health-check signals

| Metric                                                      | Healthy | Unhealthy → action |
| ----------------------------------------------------------- | ------- | ------------------ |
| `up{instance=~".*worker-extractor.*"}`                      | `1`     | `0` > 2 min → P0   |
| `vigil_worker_last_tick_seconds{worker="worker-extractor"}` | < 1 h   | > 1 h → P1         |

## SLO signals

| Metric                                          | SLO target           | Investigate-worthy                      |
| ----------------------------------------------- | -------------------- | --------------------------------------- |
| Extract latency p99 (rule-only path)            | < 100 ms             | > 1 s → rule-pass slow                  |
| Extract latency p99 (LLM path)                  | < 10 s               | > 30 s → LLM slow                       |
| `vigil_llm_calls_total{provider, outcome}` rate | matches event volume | drift indicates rule-pass coverage drop |

---

## Common failures

| Symptom                                      | Likely cause                             | Mitigation                                                                |
| -------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| Extracted field with verbatim_quote mismatch | LLM hallucination caught by L1 grounding | Expected behaviour; SafeLlmRouter drops the claim before downstream uses. |
| `LlmCircuitOpenError`                        | Tier-0 down                              | Tier-1 Bedrock failover should activate; verify Bedrock circuit closed.   |
| Extract loop slow                            | LLM cost-ceiling tripping batch mode     | Verify daily-spend; reduce concurrency if needed.                         |

---

## R1 — Routine deploy

```sh
docker compose pull worker-extractor
docker compose up -d worker-extractor
```

## R2 — Restore from backup

Reads `source.events`; emits `vigil:entity:resolve`. No local state.

## R3 — Credential rotation

`anthropic/api_key` rotation — same procedure as
[worker-counter-evidence.md R3](./worker-counter-evidence.md).
LLM-using workers share the Vault path.

## R5 — Incident response

| Severity | Trigger                                          | Action                                                                |
| -------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| **P1**   | Worker down + extract backlog > 1 h              | Page on-call. Findings can't materialise until extraction completes.  |
| **P2**   | LLM error rate > 5/min sustained                 | Investigate provider; consider Tier-1 failover if not already active. |
| **P2**   | Verbatim-grounding rejection rate > 20 %         | Audit prompt-version drift; LLM possibly hallucinating beyond schema. |
| **P3**   | Single source's extract pattern repeatedly empty | Adapter-repair: investigate selector drift via worker-adapter-repair. |

## R4 — Council pillar rotation

N/A — see [R4-council-rotation.md](./R4-council-rotation.md).

## R6 — Monthly DR exercise

Included. See [R6-dr-rehearsal.md](./R6-dr-rehearsal.md).

---

## Cross-references

- [`apps/worker-extractor/src/llm-extractor.ts`](../../apps/worker-extractor/src/llm-extractor.ts) — SafeLlmExtractor adapter.
- [`apps/worker-extractor/src/extractor.ts`](../../apps/worker-extractor/src/extractor.ts) — rule-pass + LLM-pass orchestration.
- **DECISION-011** — AI-Safety doctrine; verbatim grounding.
- **SRD §15.3** — extraction strategy.
