import { createHash, randomUUID } from 'node:crypto';

import {
  ENGINE_VERSION,
  computePosterior,
  effectiveWeights,
  dispatchTier,
  independentSourceCount,
  canonicalHashable,
} from './bayes.js';
import { IndependenceLookup, LikelihoodRatioLookup } from './registry.js';

import type { Schemas } from '@vigil/shared';

/**
 * High-level entry point — accepts raw signals plus the registries, returns
 * a complete `CertaintyAssessment` ready for persistence + dispatch.
 *
 * The adversarial pipeline (devil's advocate, counterfactual, order
 * randomisation, secondary review) is run by `assessFinding()`'s caller —
 * see `packages/certainty-engine/src/adversarial.ts`. The engine itself is
 * deterministic; adversarial results are merged into the
 * `adversarial` field by the caller before persistence.
 */

export interface RawSignal {
  readonly evidence_id: string;
  readonly pattern_id: string | null;
  readonly source_id: string | null;
  readonly strength: number;
  readonly provenance_roots: ReadonlyArray<string>;
  readonly verbatim_quote: string | null;
  readonly rationale: string;
}

export interface AssessFindingInput {
  readonly findingId: string;
  readonly signals: ReadonlyArray<RawSignal>;
  readonly severity: Schemas.Severity;
  readonly modelVersion: string;
  readonly promptRegistryHash: string;
  readonly likelihoodRatios: LikelihoodRatioLookup;
  readonly independence: IndependenceLookup;
  /** Adversarial pipeline outcome for this assessment. Defaults
   *  to "passed every check" when omitted (used by tests). */
  readonly adversarial?: Schemas.AdversarialOutcome;
  /** Override prior — defaults to the registry's prior. */
  readonly priorOverride?: number;
}

export interface AssessFindingOutput {
  readonly assessment: Schemas.CertaintyAssessment;
  readonly tier: Schemas.CertaintyTier;
  readonly holdReasons: ReadonlyArray<Schemas.HoldReason>;
}

const DEFAULT_ADVERSARIAL: Schemas.AdversarialOutcome = {
  devils_advocate_coherent: false,
  devils_advocate_summary: null,
  counterfactual_robust: true,
  counterfactual_posterior: 0,
  order_randomisation_stable: true,
  order_randomisation_min: 0,
  order_randomisation_max: 0,
  secondary_review_agreement: true,
};

export function assessFinding(input: AssessFindingInput): AssessFindingOutput {
  if (input.signals.length === 0) {
    throw new Error('assessFinding requires at least one signal');
  }

  const prior = input.priorOverride ?? input.likelihoodRatios.prior();

  // Compute effective weights from the pairwise independence registry.
  const weights = effectiveWeights({
    components: input.signals.map((s) => ({
      evidence_id: s.evidence_id,
      source_id: s.source_id,
      strength: s.strength,
    })),
    independence: (a, b) => input.independence.get(a, b),
  });

  // Resolve likelihood ratios per signal.
  const components: Schemas.CertaintyComponent[] = input.signals.map((s, i) => {
    let lr = 1.0;
    if (s.pattern_id !== null) {
      const reg = input.likelihoodRatios.get(s.pattern_id);
      if (reg !== undefined) {
        lr = reg.lr;
      }
    }
    return {
      evidence_id: s.evidence_id,
      pattern_id: s.pattern_id as Schemas.CertaintyComponent['pattern_id'],
      source_id: s.source_id as Schemas.CertaintyComponent['source_id'],
      strength: s.strength,
      likelihood_ratio: lr,
      effective_weight: weights[i] ?? 0,
      provenance_roots:
        s.provenance_roots.length > 0
          ? ([...s.provenance_roots] as Schemas.CertaintyComponent['provenance_roots'])
          : ([s.source_id ?? s.evidence_id] as Schemas.CertaintyComponent['provenance_roots']),
      verbatim_quote: s.verbatim_quote,
      rationale: s.rationale,
    };
  });

  const posteriorOut = computePosterior({ prior, components });
  const independent = independentSourceCount(components);
  const adversarial = input.adversarial ?? {
    ...DEFAULT_ADVERSARIAL,
    counterfactual_posterior: posteriorOut.posterior,
    order_randomisation_min: posteriorOut.posterior,
    order_randomisation_max: posteriorOut.posterior,
  };

  // Hold-reason aggregation. The dispatch tier is determined first by the
  // posterior + independence count, then potentially downgraded by an
  // adversarial-pipeline failure.
  const holdReasons: Schemas.HoldReason[] = [];
  let effectivePosterior = posteriorOut.posterior;

  if (independent < 5 && effectivePosterior >= 0.95) {
    holdReasons.push('sources_below_minimum');
  }
  if (!adversarial.order_randomisation_stable) {
    holdReasons.push('order_randomisation_disagreement');
  }
  if (adversarial.devils_advocate_coherent) {
    holdReasons.push('devils_advocate_coherent');
    // Documented downgrade — knock posterior into the investigation band.
    effectivePosterior = Math.min(effectivePosterior, 0.94);
  }
  if (!adversarial.counterfactual_robust) {
    holdReasons.push('counterfactual_collapse');
  }
  if (!adversarial.secondary_review_agreement) {
    holdReasons.push('secondary_review_disagreement');
  }

  const tier = dispatchTier({
    posterior: effectivePosterior,
    independentSourceCount: independent,
  });

  // Tier-32 audit closure: input_hash now covers the full reproducibility
  // surface — prior + components + severity + modelVersion + promptRegistry
  // + adversarial outcome. Pre-fix only `prior + components` were hashed,
  // so two assessments produced from the same evidence under different
  // models / different adversarial outcomes shared the same input_hash —
  // making the hash useless for the "regenerate from the same inputs"
  // reproducibility check that downstream callers rely on.
  const canonicalAdversarial = JSON.stringify({
    devils_advocate_coherent: adversarial.devils_advocate_coherent,
    devils_advocate_summary: adversarial.devils_advocate_summary,
    counterfactual_robust: adversarial.counterfactual_robust,
    counterfactual_posterior: adversarial.counterfactual_posterior,
    order_randomisation_stable: adversarial.order_randomisation_stable,
    order_randomisation_min: adversarial.order_randomisation_min,
    order_randomisation_max: adversarial.order_randomisation_max,
    secondary_review_agreement: adversarial.secondary_review_agreement,
  });
  const inputHash = createHash('sha256')
    .update(canonicalHashable({ prior, components }))
    .update('|severity=')
    .update(input.severity)
    .update('|model=')
    .update(input.modelVersion)
    .update('|prompt-registry=')
    .update(input.promptRegistryHash)
    .update('|adversarial=')
    .update(canonicalAdversarial)
    .digest('hex');

  const assessment: Schemas.CertaintyAssessment = {
    id: randomUUID(),
    finding_id: input.findingId,
    engine_version: ENGINE_VERSION,
    prior_probability: prior,
    posterior_probability: posteriorOut.posterior,
    independent_source_count: independent,
    tier,
    hold_reasons: holdReasons,
    adversarial,
    components,
    severity: input.severity,
    input_hash: inputHash,
    prompt_registry_hash: input.promptRegistryHash,
    model_version: input.modelVersion,
    computed_at: new Date().toISOString(),
  };

  return { assessment, tier, holdReasons };
}

/**
 * Counterfactual probe: drop the strongest single component, recompute the
 * posterior, return whether the assessment still clears the action threshold.
 *
 * Used by the adversarial pipeline before persistence — see
 * `adversarial.ts`. Pure function; no I/O.
 */
export function counterfactualProbe(input: {
  readonly prior: number;
  readonly components: ReadonlyArray<Schemas.CertaintyComponent>;
}): { readonly posterior: number; readonly robust: boolean } {
  if (input.components.length === 0) {
    return { posterior: input.prior, robust: false };
  }
  // Score contribution is approximately effective_weight * (LR - 1); pick
  // the component whose damped LR most exceeds 1.
  let strongestIdx = 0;
  let strongest = -Infinity;
  for (let i = 0; i < input.components.length; i++) {
    const c = input.components[i]!;
    const contribution = c.effective_weight * (c.likelihood_ratio - 1);
    if (contribution > strongest) {
      strongest = contribution;
      strongestIdx = i;
    }
  }
  const remaining = input.components.filter((_, i) => i !== strongestIdx);
  const out = computePosterior({ prior: input.prior, components: remaining });
  return { posterior: out.posterior, robust: out.posterior >= 0.95 };
}
