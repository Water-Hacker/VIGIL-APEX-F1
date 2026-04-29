import { describe, expect, it } from 'vitest';

import { assessFinding, type RawSignal } from '../src/assess.js';
import { IndependenceLookup, LikelihoodRatioLookup } from '../src/registry.js';

const lr = new LikelihoodRatioLookup({
  version: 'v1.0.0',
  prior_probability: 0.1,
  ratios: [
    {
      pattern_id: 'P-A-001',
      lr: 4.0,
      severity: 'high',
      calibrated_at: '2026-04-29T00:00:00.000Z',
      source_note: 'test fixture',
    },
    {
      pattern_id: 'P-B-001',
      lr: 6.0,
      severity: 'high',
      calibrated_at: '2026-04-29T00:00:00.000Z',
      source_note: 'test fixture',
    },
    {
      pattern_id: 'P-D-001',
      lr: 5.0,
      severity: 'high',
      calibrated_at: '2026-04-29T00:00:00.000Z',
      source_note: 'test fixture',
    },
    {
      pattern_id: 'P-E-001',
      lr: 8.0,
      severity: 'high',
      calibrated_at: '2026-04-29T00:00:00.000Z',
      source_note: 'test fixture',
    },
    {
      pattern_id: 'P-F-001',
      lr: 5.0,
      severity: 'high',
      calibrated_at: '2026-04-29T00:00:00.000Z',
      source_note: 'test fixture',
    },
  ],
});

const indep = new IndependenceLookup({
  version: 'v1.0.0',
  default_independence: 1.0,
  pairs: [],
});

const signal = (over: Partial<RawSignal>): RawSignal => ({
  evidence_id: 'sig-' + (over.pattern_id ?? 'x'),
  pattern_id: 'P-A-001',
  source_id: 'armp-main',
  strength: 1.0,
  provenance_roots: ['armp-main'],
  verbatim_quote: null,
  rationale: 'test',
  ...over,
});

describe('assessFinding — happy paths', () => {
  it('assigns log_only when posterior is low and only one source', () => {
    const r = assessFinding({
      findingId: '00000000-0000-0000-0000-000000000001',
      signals: [signal({ pattern_id: 'P-A-001' })],
      severity: 'medium',
      modelVersion: 'claude-opus-4-7-test',
      promptRegistryHash: 'a'.repeat(64),
      likelihoodRatios: lr,
      independence: indep,
    });
    // posteriorOdds = 1/9 * 4 = 4/9 = 0.444; P = 0.308
    expect(r.assessment.posterior_probability).toBeCloseTo(0.308, 2);
    expect(r.tier).toBe('log_only');
    expect(r.assessment.independent_source_count).toBe(1);
  });

  it('routes to action_queue with five independent strong corroborations', () => {
    const signals = [
      signal({ evidence_id: 'sig-1', pattern_id: 'P-A-001', source_id: 'armp-main', provenance_roots: ['armp-main'] }),
      signal({ evidence_id: 'sig-2', pattern_id: 'P-B-001', source_id: 'rccm-search', provenance_roots: ['rccm-search'] }),
      signal({ evidence_id: 'sig-3', pattern_id: 'P-D-001', source_id: 'dgi-attestations', provenance_roots: ['dgi-attestations'] }),
      signal({ evidence_id: 'sig-4', pattern_id: 'P-E-001', source_id: 'opensanctions', provenance_roots: ['opensanctions'] }),
      signal({ evidence_id: 'sig-5', pattern_id: 'P-F-001', source_id: 'opencorporates', provenance_roots: ['opencorporates'] }),
    ];
    const r = assessFinding({
      findingId: '00000000-0000-0000-0000-000000000002',
      signals,
      severity: 'high',
      modelVersion: 'claude-opus-4-7-test',
      promptRegistryHash: 'a'.repeat(64),
      likelihoodRatios: lr,
      independence: indep,
      adversarial: {
        devils_advocate_coherent: false,
        devils_advocate_summary: null,
        counterfactual_robust: true,
        counterfactual_posterior: 0.99,
        order_randomisation_stable: true,
        order_randomisation_min: 0.95,
        order_randomisation_max: 0.97,
        secondary_review_agreement: true,
      },
    });
    expect(r.assessment.posterior_probability).toBeGreaterThan(0.95);
    expect(r.assessment.independent_source_count).toBe(5);
    expect(r.tier).toBe('action_queue');
    expect(r.holdReasons).toEqual([]);
  });

  it('refuses action_queue and flags sources_below_minimum when only one provenance root despite high posterior', () => {
    // Five signals with independent source_ids (so independence registry
    // produces a non-zero posterior) but all sharing a single provenance
    // root — this is the confabulation/duplicate-data scenario.
    const signals = [
      signal({ evidence_id: 'sig-1', pattern_id: 'P-A-001', source_id: 'armp-main', provenance_roots: ['armp-main'] }),
      signal({ evidence_id: 'sig-2', pattern_id: 'P-B-001', source_id: 'rccm-search', provenance_roots: ['armp-main'] }),
      signal({ evidence_id: 'sig-3', pattern_id: 'P-D-001', source_id: 'dgi-attestations', provenance_roots: ['armp-main'] }),
      signal({ evidence_id: 'sig-4', pattern_id: 'P-E-001', source_id: 'opensanctions', provenance_roots: ['armp-main'] }),
      signal({ evidence_id: 'sig-5', pattern_id: 'P-F-001', source_id: 'opencorporates', provenance_roots: ['armp-main'] }),
    ];
    const r = assessFinding({
      findingId: '00000000-0000-0000-0000-000000000003',
      signals,
      severity: 'high',
      modelVersion: 'claude-opus-4-7-test',
      promptRegistryHash: 'a'.repeat(64),
      likelihoodRatios: lr,
      independence: indep,
    });
    expect(r.assessment.independent_source_count).toBe(1);
    expect(r.assessment.posterior_probability).toBeGreaterThan(0.95);
    expect(r.tier).toBe('investigation_queue');
    expect(r.holdReasons.includes('sources_below_minimum')).toBe(true);
  });

  it('downgrades on devil-advocate coherent', () => {
    const r = assessFinding({
      findingId: '00000000-0000-0000-0000-000000000004',
      signals: [
        signal({ evidence_id: 's1', pattern_id: 'P-A-001', source_id: 'armp-main', provenance_roots: ['armp-main'] }),
        signal({ evidence_id: 's2', pattern_id: 'P-B-001', source_id: 'rccm-search', provenance_roots: ['rccm-search'] }),
        signal({ evidence_id: 's3', pattern_id: 'P-D-001', source_id: 'dgi-attestations', provenance_roots: ['dgi-attestations'] }),
        signal({ evidence_id: 's4', pattern_id: 'P-E-001', source_id: 'opensanctions', provenance_roots: ['opensanctions'] }),
        signal({ evidence_id: 's5', pattern_id: 'P-F-001', source_id: 'opencorporates', provenance_roots: ['opencorporates'] }),
      ],
      severity: 'high',
      modelVersion: 'claude-opus-4-7-test',
      promptRegistryHash: 'a'.repeat(64),
      likelihoodRatios: lr,
      independence: indep,
      adversarial: {
        devils_advocate_coherent: true,
        devils_advocate_summary: 'plausible non-fraud explanation',
        counterfactual_robust: true,
        counterfactual_posterior: 0.95,
        order_randomisation_stable: true,
        order_randomisation_min: 0.95,
        order_randomisation_max: 0.96,
        secondary_review_agreement: true,
      },
    });
    expect(r.holdReasons.includes('devils_advocate_coherent')).toBe(true);
    expect(r.tier).toBe('investigation_queue'); // downgraded from action_queue
  });
});
