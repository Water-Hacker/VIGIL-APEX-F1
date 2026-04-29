import { describe, expect, it, vi } from 'vitest';

import type { Schemas } from '@vigil/shared';

import { runAdversarial, type LlmEvaluator } from '../src/adversarial.js';

const baseComponent: Schemas.CertaintyComponent = {
  evidence_id: 'sig-a',
  pattern_id: 'P-A-001',
  source_id: 'armp-main',
  strength: 1,
  likelihood_ratio: 4,
  effective_weight: 1,
  provenance_roots: ['armp-main'],
  verbatim_quote: null,
  rationale: 'test',
};

function fakeEvaluator(over: Partial<{
  orderPosteriors: number[];
  devilCoherent: boolean;
  secondaryAgreement: boolean;
  secondaryPosterior: number;
}> = {}): LlmEvaluator {
  const orderPosteriors = over.orderPosteriors ?? [0.96, 0.96, 0.96];
  let i = 0;
  return {
    evaluateOrder: vi.fn(async () => {
      const p = orderPosteriors[i % orderPosteriors.length] ?? 0.5;
      i++;
      return { posterior: p, rationale: 'test' };
    }),
    devilsAdvocate: vi.fn(async () => ({
      coherent: over.devilCoherent ?? false,
      summary: (over.devilCoherent ?? false) ? 'plausible' : null,
    })),
    secondaryReview: vi.fn(async () => ({
      agreement: over.secondaryAgreement ?? true,
      secondaryPosterior: over.secondaryPosterior ?? 0.95,
    })),
  };
}

describe('runAdversarial', () => {
  it('reports stable / coherent-false / robust when all checks pass', async () => {
    // Use LR=20 components so dropping the strongest still leaves posterior >= 0.95.
    const strong = (id: string, source: string): Schemas.CertaintyComponent => ({
      ...baseComponent,
      evidence_id: id,
      source_id: source,
      provenance_roots: [source],
      likelihood_ratio: 20,
    });
    const r = await runAdversarial({
      findingId: 'f1',
      prior: 0.1,
      components: [
        strong('s1', 'armp-main'),
        strong('s2', 'rccm-search'),
        strong('s3', 'dgi-attestations'),
      ],
      evaluator: fakeEvaluator({ orderPosteriors: [0.95, 0.96, 0.96], secondaryPosterior: 0.95 }),
    });
    expect(r.order_randomisation_stable).toBe(true);
    expect(r.devils_advocate_coherent).toBe(false);
    expect(r.counterfactual_robust).toBe(true);
    expect(r.secondary_review_agreement).toBe(true);
    expect(r.order_randomisation_min).toBe(0.95);
    expect(r.order_randomisation_max).toBe(0.96);
  });

  it('flags order_randomisation_stable=false on > 5pp spread', async () => {
    const r = await runAdversarial({
      findingId: 'f1',
      prior: 0.1,
      components: [baseComponent],
      evaluator: fakeEvaluator({ orderPosteriors: [0.85, 0.91, 0.97] }),
    });
    expect(r.order_randomisation_stable).toBe(false);
  });

  it('reports devil-advocate coherent + summary when evaluator returns coherent', async () => {
    const r = await runAdversarial({
      findingId: 'f1',
      prior: 0.1,
      components: [baseComponent],
      evaluator: fakeEvaluator({ devilCoherent: true }),
    });
    expect(r.devils_advocate_coherent).toBe(true);
    expect(r.devils_advocate_summary).toBe('plausible');
  });

  it('flags secondary_review_agreement=false when secondary disagrees beyond tolerance', async () => {
    const r = await runAdversarial({
      findingId: 'f1',
      prior: 0.1,
      components: [baseComponent, { ...baseComponent, evidence_id: 'sig-b', source_id: 'rccm-search' }],
      evaluator: fakeEvaluator({ secondaryAgreement: true, secondaryPosterior: 0.5 }),
    });
    expect(r.secondary_review_agreement).toBe(false);
  });

  it('reports counterfactual collapse when removing strongest component drops below 0.95', async () => {
    // Single weak component -> removing it leaves no components, posterior = prior.
    const r = await runAdversarial({
      findingId: 'f1',
      prior: 0.1,
      components: [baseComponent],
      evaluator: fakeEvaluator(),
    });
    expect(r.counterfactual_robust).toBe(false);
    expect(r.counterfactual_posterior).toBeLessThan(0.95);
  });
});
