import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { IndependenceLookup, LikelihoodRatioLookup, loadRegistries } from '../src/registry.js';

const REGISTRY_DIR = path.resolve(__dirname, '..', '..', '..', 'infra', 'certainty');

describe('registry loader', () => {
  it('validates the shipped likelihood-ratio + independence registries', async () => {
    const r = await loadRegistries(REGISTRY_DIR);
    expect(r.likelihoodRatios.version).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(r.likelihoodRatios.prior_probability).toBeGreaterThan(0);
    expect(r.likelihoodRatios.prior_probability).toBeLessThan(0.3);
    expect(r.likelihoodRatios.ratios.length).toBeGreaterThanOrEqual(40);
    expect(r.independence.version).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('covers every pattern_id present on disk', async () => {
    const r = await loadRegistries(REGISTRY_DIR);
    const lookup = new LikelihoodRatioLookup(r.likelihoodRatios);
    const expected = [
      'P-A-001','P-A-002','P-A-003','P-A-004','P-A-005','P-A-006','P-A-007','P-A-008','P-A-009',
      'P-B-001','P-B-002','P-B-003','P-B-004','P-B-005','P-B-006','P-B-007',
      'P-C-001','P-C-002','P-C-003','P-C-004','P-C-005','P-C-006',
      'P-D-001','P-D-002','P-D-003','P-D-004','P-D-005',
      'P-E-001','P-E-002','P-E-003','P-E-004',
      'P-F-001','P-F-002','P-F-003','P-F-004','P-F-005',
      'P-G-001','P-G-002','P-G-003','P-G-004',
      'P-H-001','P-H-002','P-H-003',
    ];
    for (const id of expected) {
      const lr = lookup.get(id);
      expect(lr, `expected an LR for ${id}`).toBeDefined();
      expect(lr!.lr).toBeGreaterThan(0);
      expect(lr!.lr).toBeLessThanOrEqual(50);
    }
  });

  it('returns the correct independence score for known dependent pairs', async () => {
    const r = await loadRegistries(REGISTRY_DIR);
    const indep = new IndependenceLookup(r.independence);
    expect(indep.get('minfi-portal', 'minfi-bis')).toBe(0.4);
    expect(indep.get('worldbank-sanctions', 'opensanctions')).toBe(0.5);
    expect(indep.get('foo', 'foo')).toBe(0);
    expect(indep.get('foo', 'bar')).toBe(r.independence.default_independence);
  });
});
