# AI SAFETY DOCTRINE — VIGIL APEX
## Bayesian certainty + LLM failure-mode defences
**Version 1.0 — 2026-04-29**
**Status: BINDING.** This document supersedes any verbal claim about how the
platform reaches its findings. Every reviewer (World Bank, IMF, EU, AfDB,
internal magistrate) must be answered with the mechanism described here.

---

## Operating principle

> The LLM is a research assistant, not an authority.

Claude extracts facts, identifies pattern matches, drafts structured
analysis, and writes narrative. **Claude does not decide, does not score
certainty, and does not vote.** Decisions are made by:

1. The **Bayesian certainty engine** at
   [`packages/certainty-engine/`](../../packages/certainty-engine/) operating
   on documented likelihood ratios + a calibrated prior;
2. The **adversarial pipeline** at
   [`packages/certainty-engine/src/adversarial.ts`](../../packages/certainty-engine/src/adversarial.ts);
3. The **CONAC-seconded analyst** reviewing every action-queue entry;
4. The **5-pillar council** requiring 3-of-5 institutional signatures.

Claude is one component of a layered system; it is not the system.

---

## PART A — The Bayesian Certainty Engine

### A.1 Pattern matching alone is dangerous

A pattern says *"vendor created < 30 days before tender + single-source
justification = suspicious"*. Many legitimate contracts match. Treating
pattern-match as fraud accuses innocent vendors. The engine instead asks:
**given everything we know from all sources, what is P(fraud | evidence)?**

### A.2 The math

```
priorOdds      = P / (1 - P)
componentDelta = 1 + effective_weight * (LR - 1)
posteriorOdds  = priorOdds × ∏ componentDelta
posterior      = posteriorOdds / (1 + posteriorOdds)
```

`effective_weight ∈ [0,1]` is the **min pairwise independence** between
the component's source and every other contributing source. Two sources
that share a primary-source root collapse each other's weight toward 0.

The implementation lives in [`packages/certainty-engine/src/bayes.ts`](../../packages/certainty-engine/src/bayes.ts);
unit tests in
[`packages/certainty-engine/__tests__/bayes.test.ts`](../../packages/certainty-engine/__tests__/bayes.test.ts).

### A.3 Inputs

| Input | Source | Authority |
|---|---|---|
| `prior_probability` | [`infra/certainty/likelihood-ratios.json`](../../infra/certainty/likelihood-ratios.json) | Calibrated quarterly from Cour des Comptes / TCS / ARMP outcomes (§2.6). |
| `likelihood_ratio` (per pattern) | same JSON | Documented per pattern_id; reviewed quarterly. |
| `independence` (per source-pair) | [`infra/certainty/independence-weights.json`](../../infra/certainty/independence-weights.json) | Architect-signed weights between known dependent feeds. |
| `provenance_roots` (per fact) | `certainty.fact_provenance` table | Walks every claim back to primary sources. |

### A.4 Three-tier dispatch (`certainty-engine`'s `dispatchTier`)

| Tier | Conditions | What happens |
|---|---|---|
| **action_queue** | `posterior ≥ 0.95` AND `≥ 5` distinct provenance roots | Adversarial pipeline runs; on PASS the finding enters the analyst review queue; on FAIL routed to investigation. Only this tier can become a CONAC referral. |
| **investigation_queue** | `0.80 ≤ posterior < 0.95` | Analyst review; no automatic dossier; not exposed to council. |
| **log_only** | `posterior < 0.80` | Recorded for calibration analysis; never escalated, never seen by analyst or council. |

**The 5-source minimum rule** is enforced over the *union* of provenance
roots across components — five news articles all citing one ARMP notice
count as **one** source. A finding that does not have five distinct
primary-source provenance roots **cannot** reach `action_queue` regardless
of posterior.

### A.5 Adversarial pipeline

Every assessment that crosses 0.95 runs four independent checks before
persistence (`packages/certainty-engine/src/adversarial.ts`):

1. **Order randomisation (3×).** Three Claude passes with shuffled
   evidence order. Disagreement > 5pp → `order_randomisation_disagreement`.
2. **Devil's advocate.** Second Claude pass with the prompt *"find the
   strongest reasonable explanation that is NOT fraud"*. Coherent →
   `devils_advocate_coherent` and posterior is downgraded into the
   investigation band.
3. **Counterfactual probe.** Drop the strongest single component, recompute
   the posterior. Collapse below 0.95 → `counterfactual_collapse`.
4. **Independent secondary review.** Different system prompt, different
   framing. Disagreement > tolerance → `secondary_review_disagreement`.

Hold reasons are recorded on the assessment row (`certainty.assessment.hold_reasons`)
and surfaced in the operator UI.

### A.6 Calibration audit (quarterly)

Every 90 days, every action-queue and investigation-queue finding from the
preceding quarter is re-scored against actual outcomes (CONAC investigation
results, court decisions, withdrawn referrals). The
[`calibration.audit_run`](../../packages/db-postgres/drizzle/0009_certainty_engine.sql)
table holds the run; per-band predicted vs observed rates land in
`calibration.reliability_band`. Bands whose `calibration_gap > 0.05` are
flagged for review and the underlying likelihood ratios are recalibrated.

Each run is countersigned by the architect, the analyst, and an
independent reviewer; the run id is anchored to the audit chain via the
`anchor_audit_event_id` column.

The dashboard exposes the latest audit at `/calibration/reliability`.

---

## PART B — LLM failure modes & defences

Each failure mode is documented; for each, the platform wires a layered
engineering defence. No single defence is treated as sufficient; the
architecture assumes any individual defence will fail and requires
multiple to confirm before a finding crosses the action threshold.

### B.1 Hallucination — `inventing facts`

| Defence | Code |
|---|---|
| Forced citation schema `{claim, source_record_id, source_field, verbatim_quote}` | [`packages/llm/src/safety/citation.ts`](../../packages/llm/src/safety/citation.ts) (`zCitedClaim`) |
| Schema-validated output (failures retry the call) | [`packages/llm/src/safe-router.ts`](../../packages/llm/src/safe-router.ts) |
| 5-source minimum rule (Bayesian engine refuses < 5 provenance roots) | `certainty-engine.dispatchTier` |
| Verbatim retrieval audit (5 % daily sampler) | `llm.verbatim_audit_sample` table + `VerbatimAuditRepo.hallucinationRate()` |
| Low temperature default (T = 0.1) | `SafeLlmRouter` |

### B.2 Confabulation — `stitching unrelated facts`

| Defence | Code |
|---|---|
| Causal claims forbidden in extraction layer (schema-rejected) | `zCitedExtraction` |
| Independence checking via primary-source roots | `effectiveWeights()` + `independentSourceCount()` |
| Devil's-advocate pass | `adversarial.runAdversarial` |
| Counterfactual probe | `assess.counterfactualProbe` |

### B.3 Overconfidence — `miscalibrated probabilities`

| Defence | Code |
|---|---|
| Calibration NOT given to the LLM (engine computes posterior) | `bayes.computePosterior` |
| Quarterly calibration audit | `calibration.audit_run` + `CalibrationAuditRepo` |
| Per-pattern reliability diagram on `/calibration/reliability` | `dashboard/src/lib/certainty.server.ts` |

### B.4 Prompt injection — `adversarial input data`

| Defence | Code |
|---|---|
| Closed-context wrapping with `<source_document>` markers | [`packages/llm/src/safety/closed-context.ts`](../../packages/llm/src/safety/closed-context.ts) |
| Schema validation (rejects "mark cleared" responses) | `SafeLlmRouter.call` |
| **Daily-rotated canary** — Claude is told never to repeat it; a leaked canary triggers a quarantine | [`packages/llm/src/safety/canary.ts`](../../packages/llm/src/safety/canary.ts) |
| Independent secondary review | `runAdversarial` |

### B.5 Training-data contamination

| Defence | Code |
|---|---|
| Closed-context system preamble forbids external knowledge | `closed-context.ts` (`DEFAULT_PREAMBLE`) |
| Verbatim grounding (claims must be in cited source) | `validateVerbatimGrounding` |

### B.6 Duplicate data / double-counting

| Defence | Code |
|---|---|
| `certainty.fact_provenance` graph deduplicates by primary-source root | `FactProvenanceRepo` |
| Pairwise independence registry shrinks weight on dependent pairs | `infra/certainty/independence-weights.json` + `IndependenceLookup` |

### B.7 Long-context degradation

| Defence | Code |
|---|---|
| Hierarchical reasoning — small focused calls, never 100-page contexts | platform pattern (worker-extract → worker-pattern → worker-score) |
| Evidence summary tables (citations, not raw documents) | engine input shape |

### B.8 Anchoring / order effects

| Defence | Code |
|---|---|
| 3× order randomisation with > 5pp disagreement → `order_randomisation_disagreement` hold | `runAdversarial` |
| Symmetric evidence presentation (claim + exonerating context in same paragraph) | prompt template convention |

### B.9 Sycophancy

| Defence | Code |
|---|---|
| Neutral framing in every prompt | prompt templates |
| Devil's-advocate pass (downgrades on coherent counter-argument) | `runAdversarial` |
| Architect cannot directly edit findings (changes are evidence-side, audit-logged) | `audit.actions` chain |

### B.10 Temporal / date reasoning errors

| Defence | Code |
|---|---|
| All dates parsed deterministically at ingestion (Python / Postgres), never asked of Claude | adapter base in `packages/adapters/` |
| Pre-computed timeline summaries presented to Claude | engine input shape |

### B.11 Language / translation drift

| Defence | Code |
|---|---|
| Single-language reasoning windows (extract in source language → translate → reason) | worker-extract pipeline |
| Bilingual outputs (FR primary, EN automatic) verified by a native French technical reviewer before any dossier ships | `packages/dossier/src/render.ts` + analyst review |

### B.12 Prompt version drift / non-reproducibility

| Defence | Code |
|---|---|
| `PromptRegistry` + per-template SHA-256 hash | [`packages/llm/src/safety/prompt-registry.ts`](../../packages/llm/src/safety/prompt-registry.ts) |
| `llm.prompt_template` + `llm.call_record` tables | `0009_certainty_engine.sql` |
| Every `CertaintyAssessment` carries the registry snapshot hash | `Schemas.CertaintyAssessment.prompt_registry_hash` |

### B.13 Jailbreak / safety-layer bypass

| Defence | Code |
|---|---|
| Input sanitisation (closed-context wrapping rejects free-form instructions) | `closed-context.ts` |
| Output classification by separate Haiku pass (queued for follow-up) | architecture extension point |
| Anthropic safety layer (defence in depth) | provider library |

### B.14 Model update breaks behaviour

| Defence | Code |
|---|---|
| Pinned model id on every call | `llm.call_record.model_id` |
| Regression test corpus | `packages/llm/__tests__/hallucinations.test.ts` |
| `CertaintyAssessment.model_version` records exact model used | engine field |

### B.15 Cost / rate-limit failure mid-finding

| Defence | Code |
|---|---|
| Atomic finding completion (assessment row inserted only when pipeline completes) | worker-score handler |
| Bedrock failover within seconds | `LlmRouter` provider chain |
| Local Qwen / DeepSeek tier-2 sovereign fallback | `providers/local.ts` (DEGRADED mode label) |

### B.16 Human over-reliance on the model

| Defence | Code |
|---|---|
| 5-pillar council (3-of-5 institutional signatures required) | governance contract |
| CONAC-seconded analyst review of every action-queue entry | operator workflow |
| Quarterly random audit of cleared findings by independent reviewer | `calibration.audit_run` |
| Public accountability dashboard (false positives published) | dashboard `/calibration` page |

---

## What a finding's chain of evidence guarantees

A finding that reaches the action queue:

- has a **calibrated mathematical probability** of fraud, not a narrative claim;
- can be **reproduced exactly** from the same inputs by an independent reviewer (engine + likelihood ratios + independence weights are versioned);
- is **corroborated by ≥ 5 independent provenance roots**;
- has been **reviewed adversarially** with order-randomised evidence presentation, devil's advocate, counterfactual probe, and independent secondary review;
- has passed **schema validation, content classification, and verbatim grounding**;
- has been **read by a human CONAC analyst** before any council eye sees it;
- has been **signed by 3-of-5 independent institutional pillars** before any action;
- is **anchored on the audit chain** so the chain of reasoning is permanent and auditable.

Failure of any one defence layer does not produce a false accusation —
the finding is held until either the analyst clears the hold or the
underlying calibration is reviewed.

---

## Standards referenced

- FATF R.29 evidence standards
- NIST AI Risk Management Framework
- ISO/IEC 23894
- EU AI Act Annex IV
- Anthropic Responsible Scaling Policy

## Document control

| Field | Value |
|---|---|
| Engine version | `v1.0.0` |
| Likelihood-ratio registry version | `v1.0.0` |
| Independence-weight registry version | `v1.0.0` |
| Companion to | CORE_SRD_v3, CORE_BUILD_COMPANION_v2, CORE_HSK_v1, MVP_SERVER |
| Authority | binding pending DECISION-011 → FINAL flip |
