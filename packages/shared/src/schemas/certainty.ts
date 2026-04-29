import { z } from 'zod';

import {
  zIsoInstant,
  zPatternId,
  zSeverity,
  zSha256Hex,
  zSourceId,
  zUuid,
} from './common.js';

/* =============================================================================
 * AI Safety Doctrine v1.0 — Bayesian Certainty Engine schemas (DECISION-011).
 *
 * Every finding that the platform may act on carries a CertaintyAssessment
 * containing:
 *   - the prior used (P(F))
 *   - every contributing piece of evidence with its likelihood ratio
 *   - the pairwise independence weights used in the weighted product
 *   - the posterior P(F | E1..En)
 *   - the dispatch tier (action_queue / investigation_queue / log_only)
 *   - the adversarial-pipeline outcomes (devil's advocate, counterfactual,
 *     order randomisation, secondary review) that ran before the score was
 *     accepted.
 *
 * Every CertaintyAssessment is reproducible from its inputs by an
 * independent reviewer; that is the central legal-defensibility property.
 * ===========================================================================*/

/** Action tier for a finding given its certainty assessment. */
export const zCertaintyTier = z.enum([
  'action_queue', // posterior >= 0.95 with >= 5 independent sources
  'investigation_queue', // 0.80 <= posterior < 0.95
  'log_only', // posterior < 0.80
]);
export type CertaintyTier = z.infer<typeof zCertaintyTier>;

/** Reasons a finding was held / downgraded by the adversarial pipeline. */
export const zHoldReason = z.enum([
  'order_randomisation_disagreement',
  'devils_advocate_coherent',
  'counterfactual_collapse',
  'secondary_review_disagreement',
  'sources_below_minimum',
  'verbatim_grounding_failed',
  'schema_validation_failed',
  'canary_triggered',
  'cluster_dependency',
  'lost_in_middle_regression',
]);
export type HoldReason = z.infer<typeof zHoldReason>;

export const zCertaintyComponent = z.object({
  /** Stable id per evidence type (pattern_id for pattern signals, source_id
   *  for non-pattern sources). */
  evidence_id: z.string().min(1).max(120),
  /** Pattern id if this came from a pattern detector, else null. */
  pattern_id: zPatternId.nullable(),
  /** Originating source id (e.g. 'armp-main', 'rccm-search'). null for
   *  computed signals (e.g. counter-evidence summaries). */
  source_id: zSourceId.nullable(),
  /** Raw strength reported by the pattern detector or signal source, [0,1]. */
  strength: z.number().min(0).max(1),
  /** Likelihood ratio LR(E|F) / LR(E|notF). Documented per pattern in
   *  infra/certainty/likelihood-ratios.json; signed off by the architect. */
  likelihood_ratio: z.number().positive(),
  /** Pre-computed effective weight after independence-graph deduplication.
   *  Useful for reproducing the posterior without re-walking the graph. */
  effective_weight: z.number().min(0).max(1),
  /** Provenance roots — primary source ids the evidence ultimately derives
   *  from. The 5-source minimum rule counts the union of these across all
   *  contributing components. */
  provenance_roots: z.array(zSourceId).min(1).max(50),
  /** Verbatim quote retrieved from the evidence record, if applicable. */
  verbatim_quote: z.string().max(2_000).nullable(),
  /** Free-form rationale; bounded length to discourage narrative drift. */
  rationale: z.string().max(1_000),
});
export type CertaintyComponent = z.infer<typeof zCertaintyComponent>;

export const zAdversarialOutcome = z.object({
  /** Devil's-advocate Claude pass produced a coherent non-fraud story. */
  devils_advocate_coherent: z.boolean(),
  devils_advocate_summary: z.string().max(2_000).nullable(),
  /** Removing the strongest single component still keeps posterior ≥ 0.95. */
  counterfactual_robust: z.boolean(),
  /** Posterior with the strongest-evidence component removed. */
  counterfactual_posterior: z.number().min(0).max(1),
  /** All three order-randomised passes agreed within 5 percentage points. */
  order_randomisation_stable: z.boolean(),
  /** Min/max posterior across the three randomised passes. */
  order_randomisation_min: z.number().min(0).max(1),
  order_randomisation_max: z.number().min(0).max(1),
  /** Independent secondary review (different system prompt) agreed. */
  secondary_review_agreement: z.boolean(),
});
export type AdversarialOutcome = z.infer<typeof zAdversarialOutcome>;

export const zCertaintyAssessment = z.object({
  id: zUuid,
  finding_id: zUuid,
  /** Engine version; bumped whenever Bayesian math or thresholds change. */
  engine_version: z.string().regex(/^v\d+\.\d+\.\d+$/),
  /** Prior used for this assessment (calibrated quarterly). */
  prior_probability: z.number().min(0).max(1),
  /** Final posterior P(F | components). */
  posterior_probability: z.number().min(0).max(1),
  /** Number of distinct primary-source provenance roots across all
   *  components. The 5-source minimum rule requires this >= 5 for
   *  action_queue dispatch. */
  independent_source_count: z.number().int().min(0),
  /** Routed tier given the posterior + source count. */
  tier: zCertaintyTier,
  /** Hold reasons recorded by the adversarial pipeline. Empty array means
   *  the finding passed every layer of defence. */
  hold_reasons: z.array(zHoldReason).max(20).default([]),
  /** Adversarial-pipeline summary. */
  adversarial: zAdversarialOutcome,
  /** Components that drove the posterior. */
  components: z.array(zCertaintyComponent).min(1).max(200),
  /** Severity assigned to the finding (informs body-name routing). */
  severity: zSeverity,
  /** Hash of the canonical input payload used to produce the posterior;
   *  enables exact replay by an independent reviewer. */
  input_hash: zSha256Hex,
  /** Hash of the prompt-template registry snapshot (DECISION-011 §16). */
  prompt_registry_hash: zSha256Hex,
  /** Pinned model version of the LLM that produced the components. */
  model_version: z.string().min(2).max(80),
  computed_at: zIsoInstant,
});
export type CertaintyAssessment = z.infer<typeof zCertaintyAssessment>;

/* =============================================================================
 * Likelihood-ratio + independence-weight registries — versioned config that
 * the engine reads at boot. Stored as JSON in `infra/certainty/`; mirrored
 * here as Zod for runtime validation.
 * ===========================================================================*/

export const zLikelihoodRatio = z.object({
  pattern_id: zPatternId,
  /** Likelihood ratio for the pattern firing in fraud vs in legitimate
   *  transactions. Calibrated against historical Cour des Comptes /
   *  TCS / ARMP outcomes per AI-SAFETY-DOCTRINE-v1 §2.6. */
  lr: z.number().positive().max(50),
  /** Severity tag. */
  severity: zSeverity,
  /** ISO date the value was last calibrated. */
  calibrated_at: zIsoInstant,
  /** Free-form rationale documenting the calibration source. */
  source_note: z.string().min(8).max(2_000),
});
export type LikelihoodRatio = z.infer<typeof zLikelihoodRatio>;

export const zLikelihoodRatioRegistry = z.object({
  version: z.string().regex(/^v\d+\.\d+\.\d+$/),
  prior_probability: z.number().min(0).max(1),
  ratios: z.array(zLikelihoodRatio).min(1),
});
export type LikelihoodRatioRegistry = z.infer<typeof zLikelihoodRatioRegistry>;

export const zIndependenceWeight = z.object({
  source_a: zSourceId,
  source_b: zSourceId,
  /** 0 = fully dependent (both derived from the same upstream feed). 1 = fully
   *  independent. The Bayesian product uses this to prevent double-counting. */
  independence: z.number().min(0).max(1),
  rationale: z.string().min(8).max(1_000),
});
export type IndependenceWeight = z.infer<typeof zIndependenceWeight>;

export const zIndependenceWeightRegistry = z.object({
  version: z.string().regex(/^v\d+\.\d+\.\d+$/),
  default_independence: z.number().min(0).max(1).default(1.0),
  pairs: z.array(zIndependenceWeight),
});
export type IndependenceWeightRegistry = z.infer<typeof zIndependenceWeightRegistry>;

/* =============================================================================
 * Calibration audit run + reliability bands — quarterly artefact per the
 * AI-SAFETY-DOCTRINE-v1 §2.6.
 * ===========================================================================*/

export const zReliabilityBand = z.object({
  band_label: z.string().min(2).max(40), // e.g. "0.95-0.97"
  band_min: z.number().min(0).max(1),
  band_max: z.number().min(0).max(1),
  predicted_rate: z.number().min(0).max(1),
  observed_rate: z.number().min(0).max(1),
  finding_count: z.number().int().nonnegative(),
  cleared_count: z.number().int().nonnegative(),
  confirmed_count: z.number().int().nonnegative(),
  /** Absolute calibration gap; bands above 0.05 are flagged for review. */
  calibration_gap: z.number().min(0).max(1),
});
export type ReliabilityBand = z.infer<typeof zReliabilityBand>;

export const zCalibrationAuditRun = z.object({
  id: zUuid,
  /** Quarter label, e.g. "2026-Q2". */
  period_label: z.string().regex(/^\d{4}-Q[1-4]$/),
  period_start: zIsoInstant,
  period_end: zIsoInstant,
  /** Engine version under audit. */
  engine_version: z.string().regex(/^v\d+\.\d+\.\d+$/),
  bands: z.array(zReliabilityBand).min(1).max(50),
  /** Per-pattern breakdown — patterns with calibration gaps above 0.05 are
   *  flagged for demotion / removal. */
  per_pattern_gap: z.record(zPatternId, z.number().min(0).max(1)).default({}),
  /** Hyperledger anchor — populated once the run is signed off. */
  anchor_audit_event_id: z.string().nullable(),
  computed_at: zIsoInstant,
  /** Architect + analyst + independent reviewer signatures. */
  signoff: z
    .object({
      architect: z.string().nullable(),
      analyst: z.string().nullable(),
      independent_reviewer: z.string().nullable(),
    })
    .default({ architect: null, analyst: null, independent_reviewer: null }),
});
export type CalibrationAuditRun = z.infer<typeof zCalibrationAuditRun>;

/* =============================================================================
 * Prompt-template registry + LLM call record — DECISION-011 §12, §14.
 * ===========================================================================*/

export const zPromptTemplate = z.object({
  id: zUuid,
  /** Stable name across versions, e.g. 'extraction.armp-events'. */
  name: z.string().min(3).max(120),
  /** Semver-like; bumped on any text change. */
  version: z.string().regex(/^v\d+\.\d+\.\d+$/),
  /** Hash of the canonical text — used for verifying replay. */
  template_hash: zSha256Hex,
  /** ISO instant of registration. */
  registered_at: zIsoInstant,
  /** Free-form description (visible in dashboards). */
  description: z.string().max(2_000),
  /** Whether currently in production rotation. */
  active: z.boolean(),
});
export type PromptTemplate = z.infer<typeof zPromptTemplate>;

export const zLlmCallRecord = z.object({
  id: zUuid,
  /** Linked finding (or null for utility calls). */
  finding_id: zUuid.nullable(),
  /** Linked certainty assessment (set when the call is part of one). */
  assessment_id: zUuid.nullable(),
  prompt_name: z.string().min(3).max(120),
  prompt_version: z.string().regex(/^v\d+\.\d+\.\d+$/),
  prompt_template_hash: zSha256Hex,
  /** Pinned model id (e.g. 'claude-opus-4-7-20251020'). */
  model_id: z.string().min(2).max(80),
  /** Sampler temperature actually used. */
  temperature: z.number().min(0).max(1),
  /** SHA-256 of the rendered prompt + structured inputs. */
  input_hash: zSha256Hex,
  /** SHA-256 of the raw model output. */
  output_hash: zSha256Hex,
  /** Whether the daily-rotated canary phrase appeared in the output (= the
   *  system prompt was leaked / overridden by injected instructions). */
  canary_triggered: z.boolean(),
  /** Whether output passed schema validation. */
  schema_valid: z.boolean(),
  /** Latency in ms. */
  latency_ms: z.number().int().nonnegative(),
  /** USD cost; 0 for cached / replayed calls. */
  cost_usd: z.number().min(0),
  called_at: zIsoInstant,
});
export type LlmCallRecord = z.infer<typeof zLlmCallRecord>;
