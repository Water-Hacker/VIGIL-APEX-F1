/**
 * Tier-59 audit closure — Bayesian damping must clamp to [0, 1].
 *
 * Pre-fix, `correlationDamping > 1` produced `1 - damping < 0`, and
 * `lr ** (1 - damping)` INVERTED each redundant-pair's contribution
 * — a strong positive signal silently became a strong negative
 * signal in the posterior. `correlationDamping < 0` amplified
 * instead of dampening. Both modes silently corrupted the posterior
 * for any caller that passed an out-of-range value (including via
 * a config-injection bug or a malformed dashboard input).
 *
 * Post-fix, the damping is clamped to `[0, 1]` with `Number.isFinite`
 * fallback to the default 0.5. Also adds defence-in-depth filtering
 * of malformed correlation-pair tuples.
 */
import { describe, expect, it } from 'vitest';

import { bayesianPosterior, type BayesianSignal } from '../src/bayesian.js';

const SIG = (pattern_id: string, strength: number, prior = 0.1, weight = 1): BayesianSignal => ({
  pattern_id,
  prior,
  strength,
  weight,
});

describe('Tier-59 — bayesianPosterior clamps correlationDamping', () => {
  const pair: ReadonlyArray<readonly [string, string]> = [['p-a-001', 'p-a-002']];
  const sigs = [SIG('p-a-001', 0.8), SIG('p-a-002', 0.8)];

  it('damping=0.5 is unchanged (regression sanity)', () => {
    const v = bayesianPosterior(sigs, { correlationDamping: 0.5, correlatedPairs: pair });
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it('damping=1.5 clamps to 1 (drops redundant evidence completely, does NOT invert)', () => {
    const v15 = bayesianPosterior(sigs, { correlationDamping: 1.5, correlatedPairs: pair });
    const v1 = bayesianPosterior(sigs, { correlationDamping: 1, correlatedPairs: pair });
    expect(v15).toBeCloseTo(v1, 6);
  });

  it('damping=-0.5 clamps to 0 (no correction; matches damping=0)', () => {
    const vNeg = bayesianPosterior(sigs, { correlationDamping: -0.5, correlatedPairs: pair });
    const v0 = bayesianPosterior(sigs, { correlationDamping: 0, correlatedPairs: pair });
    expect(vNeg).toBeCloseTo(v0, 6);
  });

  it('damping=NaN falls back to default 0.5', () => {
    const vNaN = bayesianPosterior(sigs, { correlationDamping: Number.NaN, correlatedPairs: pair });
    const v05 = bayesianPosterior(sigs, { correlationDamping: 0.5, correlatedPairs: pair });
    expect(vNaN).toBeCloseTo(v05, 6);
  });

  it('damping=Infinity falls back to default 0.5', () => {
    const vInf = bayesianPosterior(sigs, {
      correlationDamping: Number.POSITIVE_INFINITY,
      correlatedPairs: pair,
    });
    const v05 = bayesianPosterior(sigs, { correlationDamping: 0.5, correlatedPairs: pair });
    expect(vInf).toBeCloseTo(v05, 6);
  });

  it('malformed correlatedPairs tuple is silently dropped (defence in depth)', () => {
    // TS prevents this; force the bypass via cast to simulate
    // type-erasure at a JSON boundary.
    const badPair = [['p-a-001', undefined] as unknown as readonly [string, string]];
    const v = bayesianPosterior(sigs, { correlationDamping: 0.5, correlatedPairs: badPair });
    // No throw, returns a sensible number in [0, 1].
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });
});
