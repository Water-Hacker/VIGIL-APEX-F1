/**
 * Tier-60 audit closure — explicit finite-number validation in
 * computePosterior + clampUnit treats NaN as 0 in effectiveWeights.
 *
 * Pre-fix, a NaN `likelihood_ratio` or `effective_weight` slipped
 * through the bounds checks (`NaN < 0` and `NaN > 1` both false) and
 * poisoned the odds product. The eventual throw came from
 * `oddsToProbability` with a generic "got NaN" message that did not
 * identify the originating component.
 *
 * Post-fix, the per-component validator names the offending
 * `evidence_id` and `effectiveWeights` returns 0 for non-finite
 * strength/independence (matches the "buggy component contributes
 * nothing" posture of bayesianPosterior's cleanSignal filter).
 */
import { describe, expect, it } from 'vitest';

import { computePosterior, effectiveWeights } from '../src/bayes.js';

function mkComponent(
  overrides: Partial<{
    evidence_id: string;
    pattern_id: string | null;
    source_id: string | null;
    strength: number;
    likelihood_ratio: number;
    effective_weight: number;
    provenance_roots: ReadonlyArray<string>;
    verbatim_quote: string;
    rationale: string;
  }>,
) {
  return {
    evidence_id: 'e-1',
    pattern_id: 'p-a-001',
    source_id: 's-1',
    strength: 0.5,
    likelihood_ratio: 2,
    effective_weight: 0.5,
    provenance_roots: ['root-1'],
    verbatim_quote: 'q',
    rationale: 'r',
    ...overrides,
  };
}

describe('Tier-60 — computePosterior validates finite numbers per-component', () => {
  it('rejects NaN likelihood_ratio with named evidence_id', () => {
    expect(() =>
      computePosterior({
        prior: 0.1,
        components: [mkComponent({ evidence_id: 'e-bad', likelihood_ratio: Number.NaN })],
      }),
    ).toThrow(/likelihood_ratio must be a finite number for e-bad/);
  });

  it('rejects Infinity likelihood_ratio with named evidence_id', () => {
    expect(() =>
      computePosterior({
        prior: 0.1,
        components: [
          mkComponent({ evidence_id: 'e-inf', likelihood_ratio: Number.POSITIVE_INFINITY }),
        ],
      }),
    ).toThrow(/likelihood_ratio must be a finite number for e-inf/);
  });

  it('rejects NaN effective_weight with named evidence_id', () => {
    expect(() =>
      computePosterior({
        prior: 0.1,
        components: [mkComponent({ evidence_id: 'e-w', effective_weight: Number.NaN })],
      }),
    ).toThrow(/effective_weight must be a finite number for e-w/);
  });

  it('still accepts a normal component (no regression)', () => {
    const r = computePosterior({
      prior: 0.1,
      components: [mkComponent({ likelihood_ratio: 4 })],
    });
    expect(r.posterior).toBeGreaterThan(0.1);
    expect(r.posterior).toBeLessThan(1);
  });
});

describe('Tier-60 — effectiveWeights treats NaN strength as 0', () => {
  it('NaN strength contributes 0 weight (no NaN propagation)', () => {
    const weights = effectiveWeights({
      components: [
        { evidence_id: 'a', source_id: null, strength: Number.NaN },
        { evidence_id: 'b', source_id: null, strength: 0.5 },
      ],
      independence: () => 1,
    });
    expect(weights[0]).toBe(0);
    expect(weights[1]).toBe(0.5);
  });

  it('Infinity strength → non-finite → clampUnit returns 0', () => {
    // clampUnit treats ANY non-finite as 0 (matches the "buggy component
    // contributes nothing" posture). Documenting this so callers
    // don't expect Infinity→1 clamping.
    const weights = effectiveWeights({
      components: [{ evidence_id: 'a', source_id: null, strength: Number.POSITIVE_INFINITY }],
      independence: () => 1,
    });
    expect(weights[0]).toBe(0);
  });

  it('negative strength clamps to 0', () => {
    const weights = effectiveWeights({
      components: [{ evidence_id: 'a', source_id: null, strength: -0.5 }],
      independence: () => 1,
    });
    expect(weights[0]).toBe(0);
  });

  it('NaN independence contribution silently ignored (no NaN leak via minIndep)', () => {
    const weights = effectiveWeights({
      components: [
        { evidence_id: 'a', source_id: 's-1', strength: 0.8 },
        { evidence_id: 'b', source_id: 's-2', strength: 0.8 },
      ],
      independence: () => Number.NaN,
    });
    // NaN independence is filtered → minIndep stays at 1 → weight = strength.
    expect(weights[0]).toBe(0.8);
  });
});
