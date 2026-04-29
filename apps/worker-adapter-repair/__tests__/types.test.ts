/**
 * worker-adapter-repair — type contracts (W-19).
 *
 * Asserts:
 *   - zCandidateSelector accepts the LLM's expected output shape
 *   - confidence + selector.value bounds enforced
 *   - CRITICAL_ADAPTERS contains every Tier-1 source per BUILD-V2 §11
 *   - isCritical() correctly partitions critical vs informational
 */
import { describe, expect, it } from 'vitest';

import { zCandidateSelector, CRITICAL_ADAPTERS, isCritical } from '../src/types.js';

describe('CandidateSelector schema', () => {
  it('accepts a CSS-selector candidate with rationale + confidence', () => {
    const r = zCandidateSelector.parse({
      selector: {
        type: 'css',
        value: 'table.results > tbody > tr',
        field_paths: { tender_id: 'td:nth-child(1)', supplier: 'td:nth-child(3)' },
      },
      rationale: 'Three columns visible; selector targets each row.',
      confidence: 0.78,
    });
    expect(r.selector?.type).toBe('css');
  });

  it('accepts the "no candidate" outcome (selector=null, rationale required)', () => {
    const r = zCandidateSelector.parse({
      selector: null,
      rationale: 'Page layout changed; cannot derive selector from current DOM.',
      confidence: 0.0,
    });
    expect(r.selector).toBeNull();
  });

  it('rejects confidence outside [0, 1]', () => {
    for (const bad of [-0.1, 1.01, 2, NaN]) {
      const r = zCandidateSelector.safeParse({
        selector: null,
        rationale: 'x',
        confidence: bad,
      });
      expect(r.success, `confidence=${bad}`).toBe(false);
    }
  });

  it('rejects unknown selector type', () => {
    const r = zCandidateSelector.safeParse({
      selector: { type: 'regex', value: '.*', field_paths: {} },
      rationale: 'x',
      confidence: 0.5,
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty selector value', () => {
    const r = zCandidateSelector.safeParse({
      selector: { type: 'css', value: '', field_paths: {} },
      rationale: 'x',
      confidence: 0.5,
    });
    expect(r.success).toBe(false);
  });

  it('caps rationale at 500 chars (LLM budget guard)', () => {
    const r = zCandidateSelector.safeParse({
      selector: null,
      rationale: 'x'.repeat(501),
      confidence: 0,
    });
    expect(r.success).toBe(false);
  });
});

describe('CRITICAL_ADAPTERS allow-list', () => {
  it('includes the four Tier-1 Cameroonian institutional sources', () => {
    for (const src of ['armp-main', 'dgi-attestations', 'cour-des-comptes', 'minfi-portal']) {
      expect(CRITICAL_ADAPTERS.has(src), src).toBe(true);
    }
  });

  it('includes the three MOU-gated direct APIs (architect approval required)', () => {
    for (const src of ['minfi-bis', 'beac-payments', 'anif-amlscreen']) {
      expect(CRITICAL_ADAPTERS.has(src), src).toBe(true);
    }
  });

  it('isCritical is the membership predicate', () => {
    expect(isCritical('armp-main')).toBe(true);
    expect(isCritical('minfi-bis')).toBe(true);
    expect(isCritical('not-a-real-source')).toBe(false);
    expect(isCritical('')).toBe(false);
  });
});
