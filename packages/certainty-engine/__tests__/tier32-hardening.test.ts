/**
 * Tier-32 audit closure tests — certainty-engine hardening.
 *
 * Two structural fixes:
 *   1. Posterior odds-clamp guards against NaN from Infinity / Infinity.
 *   2. input_hash covers the full reproducibility surface (severity +
 *      modelVersion + promptRegistryHash + adversarial outcome).
 */
import { describe, expect, it } from 'vitest';

import { assessFinding, type RawSignal } from '../src/assess.js';
import { computePosterior, oddsToProbability } from '../src/bayes.js';
import { IndependenceLookup, LikelihoodRatioLookup } from '../src/registry.js';

const lr = new LikelihoodRatioLookup({
  version: 'test-v1',
  prior_probability: 0.05,
  ratios: [
    { pattern_id: 'P-X-001', lr: 100 },
    { pattern_id: 'P-X-002', lr: 100 },
    { pattern_id: 'P-X-003', lr: 100 },
  ],
});
const indep = new IndependenceLookup({
  version: 'test-v1',
  default_independence: 1,
  pairs: [],
});

function makeSignal(i: number, pattern: string, source: string): RawSignal {
  return {
    evidence_id: `sig-${i}`,
    pattern_id: pattern,
    source_id: source,
    strength: 0.9,
    provenance_roots: [source, `aux-${i}`, `aux2-${i}`, `aux3-${i}`, `aux4-${i}`],
    verbatim_quote: null,
    rationale: '',
  };
}

describe('Tier-32 — odds-clamp prevents Infinity → NaN', () => {
  it('oddsToProbability(Infinity) returns a finite value < 1', () => {
    const p = oddsToProbability(Infinity);
    expect(p).toBeGreaterThan(0.999);
    expect(p).toBeLessThan(1);
    expect(Number.isFinite(p)).toBe(true);
  });

  it('oddsToProbability(1e30) returns a finite value < 1', () => {
    const p = oddsToProbability(1e30);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeLessThan(1);
  });

  it('computePosterior with 100 high-LR components stays finite', () => {
    const components = Array.from({ length: 100 }, (_, i) => ({
      evidence_id: `e-${i}`,
      pattern_id: 'P-X-001' as const,
      source_id: `s-${i}`,
      strength: 0.9,
      likelihood_ratio: 100,
      effective_weight: 0.9,
      provenance_roots: [`s-${i}`] as readonly string[],
      verbatim_quote: null,
      rationale: '',
    }));
    const out = computePosterior({ prior: 0.5, components });
    expect(Number.isFinite(out.posterior)).toBe(true);
    expect(Number.isNaN(out.posterior)).toBe(false);
    expect(out.posterior).toBeGreaterThan(0.999);
    expect(out.posterior).toBeLessThan(1);
  });

  it('rejects NaN odds explicitly', () => {
    expect(() => oddsToProbability(Number.NaN)).toThrow(/must be a non-negative number/);
  });

  it('rejects negative odds explicitly', () => {
    expect(() => oddsToProbability(-1)).toThrow(/must be a non-negative number/);
  });
});

describe('Tier-32 — input_hash covers reproducibility surface', () => {
  const baseSignals: RawSignal[] = [
    makeSignal(1, 'P-X-001', 's1'),
    makeSignal(2, 'P-X-002', 's2'),
    makeSignal(3, 'P-X-003', 's3'),
    makeSignal(4, 'P-X-001', 's4'),
    makeSignal(5, 'P-X-002', 's5'),
  ];

  function assess(
    overrides: {
      severity?: 'low' | 'medium' | 'high' | 'critical';
      modelVersion?: string;
      promptRegistryHash?: string;
    } = {},
  ): string {
    return assessFinding({
      findingId: 'finding-test',
      signals: baseSignals,
      severity: overrides.severity ?? 'medium',
      modelVersion: overrides.modelVersion ?? 'claude-opus-4-7',
      promptRegistryHash: overrides.promptRegistryHash ?? 'reg-hash-A',
      likelihoodRatios: lr,
      independence: indep,
    }).assessment.input_hash;
  }

  it('same inputs → identical input_hash (reproducibility baseline)', () => {
    expect(assess()).toBe(assess());
  });

  it('different severity → different input_hash', () => {
    expect(assess({ severity: 'low' })).not.toBe(assess({ severity: 'critical' }));
  });

  it('different model version → different input_hash', () => {
    expect(assess({ modelVersion: 'claude-opus-4-7' })).not.toBe(
      assess({ modelVersion: 'claude-haiku-4-5' }),
    );
  });

  it('different prompt-registry hash → different input_hash', () => {
    expect(assess({ promptRegistryHash: 'reg-hash-A' })).not.toBe(
      assess({ promptRegistryHash: 'reg-hash-B' }),
    );
  });

  it('different adversarial outcome → different input_hash', () => {
    const a = assessFinding({
      findingId: 'f',
      signals: baseSignals,
      severity: 'medium',
      modelVersion: 'm',
      promptRegistryHash: 'p',
      likelihoodRatios: lr,
      independence: indep,
      adversarial: {
        devils_advocate_coherent: false,
        devils_advocate_summary: null,
        counterfactual_robust: true,
        counterfactual_posterior: 0.9,
        order_randomisation_stable: true,
        order_randomisation_min: 0.9,
        order_randomisation_max: 0.9,
        secondary_review_agreement: true,
      },
    }).assessment.input_hash;
    const b = assessFinding({
      findingId: 'f',
      signals: baseSignals,
      severity: 'medium',
      modelVersion: 'm',
      promptRegistryHash: 'p',
      likelihoodRatios: lr,
      independence: indep,
      adversarial: {
        devils_advocate_coherent: true,
        devils_advocate_summary: 'compelling counter-narrative',
        counterfactual_robust: false,
        counterfactual_posterior: 0.5,
        order_randomisation_stable: false,
        order_randomisation_min: 0.3,
        order_randomisation_max: 0.9,
        secondary_review_agreement: false,
      },
    }).assessment.input_hash;
    expect(a).not.toBe(b);
  });
});
