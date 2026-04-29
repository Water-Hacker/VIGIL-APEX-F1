import { describe, expect, it } from 'vitest';

import {
  canonicalHashable,
  computePosterior,
  dispatchTier,
  effectiveWeights,
  independentSourceCount,
  oddsToProbability,
  priorToOdds,
} from '../src/bayes.js';

const c = (over: Partial<Parameters<typeof computePosterior>[0]['components'][number]>) => ({
  evidence_id: over.evidence_id ?? 'e',
  pattern_id: null,
  source_id: 'src',
  strength: 1.0,
  likelihood_ratio: 2.0,
  effective_weight: 1.0,
  provenance_roots: ['src'],
  verbatim_quote: null,
  rationale: '',
  ...over,
});

describe('priorToOdds / oddsToProbability', () => {
  it('roundtrips', () => {
    for (const p of [0.05, 0.1, 0.15, 0.5, 0.85]) {
      expect(oddsToProbability(priorToOdds(p))).toBeCloseTo(p, 12);
    }
  });
  it('rejects invalid priors', () => {
    expect(() => priorToOdds(0)).toThrow();
    expect(() => priorToOdds(1)).toThrow();
    expect(() => priorToOdds(-0.1)).toThrow();
  });
});

describe('computePosterior', () => {
  it('passes through prior when no evidence updates', () => {
    const r = computePosterior({
      prior: 0.1,
      components: [c({ evidence_id: 'a', likelihood_ratio: 1.0 })],
    });
    expect(r.posterior).toBeCloseTo(0.1, 10);
  });

  it('multiplies independent likelihood ratios in odds space', () => {
    const r = computePosterior({
      prior: 0.1,
      components: [
        c({ evidence_id: 'a', likelihood_ratio: 4 }),
        c({ evidence_id: 'b', likelihood_ratio: 4, source_id: 'src2', provenance_roots: ['src2'] }),
      ],
    });
    // priorOdds = 1/9; product LR = 16; posteriorOdds = 16/9; P = 16/25 = 0.64
    expect(r.posterior).toBeCloseTo(16 / 25, 10);
  });

  it('damps via effective_weight = 0 (no update)', () => {
    const r = computePosterior({
      prior: 0.1,
      components: [c({ evidence_id: 'a', likelihood_ratio: 10, effective_weight: 0 })],
    });
    expect(r.posterior).toBeCloseTo(0.1, 10);
  });

  it('damps via effective_weight = 0.5 (half-update of LR-1)', () => {
    // damped LR = 1 + 0.5 * (5 - 1) = 3
    const r = computePosterior({
      prior: 0.1,
      components: [c({ evidence_id: 'a', likelihood_ratio: 5, effective_weight: 0.5 })],
    });
    // priorOdds = 1/9; postOdds = 3/9 = 1/3; P = 1/4 = 0.25
    expect(r.posterior).toBeCloseTo(0.25, 10);
  });

  it('rejects non-positive likelihood ratios', () => {
    expect(() =>
      computePosterior({
        prior: 0.1,
        components: [c({ evidence_id: 'a', likelihood_ratio: 0 })],
      }),
    ).toThrow();
  });

  it('rejects out-of-range effective weights', () => {
    expect(() =>
      computePosterior({
        prior: 0.1,
        components: [c({ evidence_id: 'a', effective_weight: 1.5 })],
      }),
    ).toThrow();
  });

  it('is permutation-invariant on independent components', () => {
    const a = c({ evidence_id: 'a', likelihood_ratio: 3 });
    const b = c({ evidence_id: 'b', likelihood_ratio: 7, source_id: 's2', provenance_roots: ['s2'] });
    const r1 = computePosterior({ prior: 0.1, components: [a, b] });
    const r2 = computePosterior({ prior: 0.1, components: [b, a] });
    expect(r1.posterior).toBeCloseTo(r2.posterior, 12);
  });
});

describe('effectiveWeights', () => {
  it('zeroes the weight for two fully-dependent sources', () => {
    const w = effectiveWeights({
      components: [
        { evidence_id: 'a', source_id: 's1', strength: 1 },
        { evidence_id: 'b', source_id: 's2', strength: 1 },
      ],
      independence: () => 0,
    });
    expect(w).toEqual([0, 0]);
  });

  it('keeps the weight at strength when fully independent', () => {
    const w = effectiveWeights({
      components: [
        { evidence_id: 'a', source_id: 's1', strength: 0.7 },
        { evidence_id: 'b', source_id: 's2', strength: 0.3 },
      ],
      independence: () => 1,
    });
    expect(w[0]).toBeCloseTo(0.7, 10);
    expect(w[1]).toBeCloseTo(0.3, 10);
  });

  it('uses min pairwise independence per component', () => {
    const indepMap: Record<string, number> = {
      's1|s2': 1.0,
      's1|s3': 0.2,
      's2|s3': 1.0,
    };
    const indep = (a: string, b: string) => indepMap[`${[a, b].sort().join('|')}`] ?? 1;
    const w = effectiveWeights({
      components: [
        { evidence_id: 'a', source_id: 's1', strength: 1 },
        { evidence_id: 'b', source_id: 's2', strength: 1 },
        { evidence_id: 'c', source_id: 's3', strength: 1 },
      ],
      independence: indep,
    });
    expect(w[0]).toBeCloseTo(0.2, 10); // s1 vs s3 = 0.2
    expect(w[1]).toBeCloseTo(1.0, 10);
    expect(w[2]).toBeCloseTo(0.2, 10);
  });

  it('passes through strength for null source_id (computed signals)', () => {
    const w = effectiveWeights({
      components: [
        { evidence_id: 'a', source_id: null, strength: 0.6 },
        { evidence_id: 'b', source_id: 's2', strength: 1.0 },
      ],
      independence: () => 0,
    });
    expect(w[0]).toBeCloseTo(0.6, 10);
  });
});

describe('independentSourceCount', () => {
  it('counts the union of provenance roots', () => {
    const n = independentSourceCount([
      c({ evidence_id: 'a', provenance_roots: ['armp', 'rccm'] }),
      c({ evidence_id: 'b', provenance_roots: ['armp', 'dgi'] }),
      c({ evidence_id: 'c', provenance_roots: ['opensanctions'] }),
    ]);
    expect(n).toBe(4);
  });
});

describe('dispatchTier', () => {
  it('routes to action_queue at >=0.95 with >=5 sources', () => {
    expect(dispatchTier({ posterior: 0.95, independentSourceCount: 5 })).toBe('action_queue');
    expect(dispatchTier({ posterior: 0.99, independentSourceCount: 7 })).toBe('action_queue');
  });
  it('refuses action_queue when sources < 5', () => {
    expect(dispatchTier({ posterior: 0.99, independentSourceCount: 4 })).toBe(
      'investigation_queue',
    );
  });
  it('routes 0.80-0.94 to investigation_queue', () => {
    expect(dispatchTier({ posterior: 0.8, independentSourceCount: 1 })).toBe(
      'investigation_queue',
    );
    expect(dispatchTier({ posterior: 0.94, independentSourceCount: 99 })).toBe(
      'investigation_queue',
    );
  });
  it('routes < 0.80 to log_only', () => {
    expect(dispatchTier({ posterior: 0.79, independentSourceCount: 99 })).toBe('log_only');
  });
});

describe('canonicalHashable', () => {
  it('is identical regardless of component order', () => {
    const a = c({ evidence_id: 'a' });
    const b = c({ evidence_id: 'b', source_id: 's2', provenance_roots: ['s2'] });
    expect(canonicalHashable({ prior: 0.1, components: [a, b] })).toEqual(
      canonicalHashable({ prior: 0.1, components: [b, a] }),
    );
  });
});
