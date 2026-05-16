import type { Schemas } from '@vigil/shared';

/**
 * Bayesian certainty math — AI-SAFETY-DOCTRINE-v1 Part A.
 *
 * Pure functions. No I/O, no logging, no randomness. Every output is a
 * deterministic function of inputs; every assessment is therefore
 * reproducible by an independent reviewer from the same prior, the same
 * likelihood-ratio registry, and the same independence-weight registry.
 *
 * Implementation notes:
 *   - We work in odds space throughout. priorOdds = P / (1 - P).
 *   - Each component's contribution is `effective_weight * (LR - 1) + 1`,
 *     where `effective_weight in [0, 1]` shrinks dependent components
 *     toward 1 (no update). Independence == 1 yields the textbook product
 *     of likelihood ratios; independence == 0 collapses to a single update.
 *   - The 5-source minimum rule is computed over the *union* of provenance
 *     roots across all components, not by counting components.
 */

export const ENGINE_VERSION = 'v1.0.0';

export interface ComputePosteriorInput {
  readonly prior: number;
  readonly components: ReadonlyArray<Schemas.CertaintyComponent>;
}

export interface ComputePosteriorOutput {
  readonly priorOdds: number;
  readonly posteriorOdds: number;
  readonly posterior: number;
}

export function priorToOdds(prior: number): number {
  if (prior <= 0 || prior >= 1) {
    throw new Error(`prior must be in (0,1), got ${prior}`);
  }
  return prior / (1 - prior);
}

/**
 * Tier-32 audit closure: many high-LR components stacking multiplicatively
 * can push odds past Number.MAX_VALUE, and Infinity → NaN through
 * `Infinity / (1 + Infinity)`. Clamp at 1e15 so `clamp / (1 + clamp)`
 * is still strictly < 1 at IEEE-754 precision (`1 + 1e18` rounds to
 * `1e18` because 1e18 > 2^53; 1e15 stays representable).
 */
const ODDS_CLAMP = 1e15;

export function oddsToProbability(odds: number): number {
  if (Number.isNaN(odds) || odds < 0) {
    throw new Error(`odds must be a non-negative number, got ${odds}`);
  }
  if (!Number.isFinite(odds) || odds > ODDS_CLAMP) {
    return ODDS_CLAMP / (1 + ODDS_CLAMP);
  }
  return odds / (1 + odds);
}

/**
 * Compute the posterior probability from a prior + components, where each
 * component carries a likelihood ratio AND a pre-computed effective weight
 * in [0,1] that captures how much the engine trusts the component as an
 * independent update. effective_weight is normally produced by
 * `effectiveWeights()` below from the independence registry.
 */
export function computePosterior(input: ComputePosteriorInput): ComputePosteriorOutput {
  const priorOdds = priorToOdds(input.prior);
  let odds = priorOdds;
  for (const c of input.components) {
    if (c.likelihood_ratio <= 0) {
      throw new Error(`likelihood_ratio must be > 0 for ${c.evidence_id}`);
    }
    if (c.effective_weight < 0 || c.effective_weight > 1) {
      throw new Error(`effective_weight must be in [0,1] for ${c.evidence_id}`);
    }
    // Damped LR — collapses to 1 (no update) when effective_weight == 0.
    const damped = 1 + c.effective_weight * (c.likelihood_ratio - 1);
    if (damped <= 0) {
      throw new Error(`damped LR went non-positive for ${c.evidence_id}`);
    }
    odds = odds * damped;
    // Tier-32 audit closure: cap the running odds product so a long
    // chain of high-LR components cannot push the multiplicative
    // accumulator past Number.MAX_VALUE → Infinity → NaN downstream.
    if (odds > ODDS_CLAMP) odds = ODDS_CLAMP;
  }
  return {
    priorOdds,
    posteriorOdds: odds,
    posterior: oddsToProbability(odds),
  };
}

/**
 * Compute effective weights from raw component strengths plus the pairwise
 * independence registry. The weight for a component is the product of:
 *   - the component's own strength (already in [0,1]), AND
 *   - the minimum pairwise independence with every other contributing
 *     source (so a fact derived from the same root as another contributing
 *     source has its weight collapsed toward zero).
 *
 * The final effective_weight is clamped to [0, 1].
 */
export function effectiveWeights(opts: {
  readonly components: ReadonlyArray<{
    readonly evidence_id: string;
    readonly source_id: string | null;
    readonly strength: number;
  }>;
  readonly independence: (a: string, b: string) => number;
}): ReadonlyArray<number> {
  return opts.components.map((c, idx) => {
    if (c.source_id === null) return Math.max(0, Math.min(1, c.strength));
    let minIndep = 1;
    for (let j = 0; j < opts.components.length; j++) {
      if (j === idx) continue;
      const other = opts.components[j]!;
      if (other.source_id === null) continue;
      const w = opts.independence(c.source_id, other.source_id);
      if (w < minIndep) minIndep = w;
    }
    const eff = Math.max(0, Math.min(1, c.strength * minIndep));
    return eff;
  });
}

/** Distinct primary-source provenance roots across all components. */
export function independentSourceCount(
  components: ReadonlyArray<Schemas.CertaintyComponent>,
): number {
  const set = new Set<string>();
  for (const c of components) {
    for (const root of c.provenance_roots) set.add(root);
  }
  return set.size;
}

/**
 * Three-tier dispatch (AI-SAFETY-DOCTRINE-v1 §2.3 + §2.4):
 *   - >= 0.95 with >= 5 distinct provenance roots  -> action_queue
 *   - 0.80 <= P < 0.95                              -> investigation_queue
 *   - everything else                                -> log_only
 */
export function dispatchTier(opts: {
  readonly posterior: number;
  readonly independentSourceCount: number;
}): Schemas.CertaintyTier {
  const p = opts.posterior;
  const n = opts.independentSourceCount;
  if (p >= 0.95 && n >= 5) return 'action_queue';
  if (p >= 0.8) return 'investigation_queue';
  return 'log_only';
}

/** SHA-256 of a canonical JSON serialisation; used for input_hash. */
export function canonicalHashable(input: ComputePosteriorInput): string {
  // Stable key ordering. Component arrays are sorted by evidence_id so the
  // hash is permutation-independent — which matches the math (multiplication
  // is commutative once effective_weight is fixed).
  const sortedComponents = [...input.components]
    .map((c) => ({
      evidence_id: c.evidence_id,
      pattern_id: c.pattern_id,
      source_id: c.source_id,
      strength: c.strength,
      likelihood_ratio: c.likelihood_ratio,
      effective_weight: c.effective_weight,
      provenance_roots: [...c.provenance_roots].sort(),
      verbatim_quote: c.verbatim_quote,
      rationale: c.rationale,
    }))
    .sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
  return JSON.stringify({ prior: input.prior, components: sortedComponents });
}
