import { describe, it, expect, beforeAll } from 'vitest';

import { PatternRegistry } from '../src/index.js';
import { registerAllPatternsForTest } from './_load-all.js';

import { NULL_CTX, tenderSubject, companySubject, personSubject, paymentSubject, evt } from './_harness.js';

beforeAll(() => {
  registerAllPatternsForTest();
});

/**
 * Baseline coverage — 5 sanity tests per registered pattern (Phase H4).
 *
 *   1. metadata_valid       — id, category, subjectKinds, priors all in range
 *   2. tn_empty_subject     — empty subject returns matched=false
 *   3. tn_irrelevant_event  — unrelated event kind returns matched=false
 *   4. tn_wrong_subject_kind — subject of an unsupported kind returns matched=false
 *   5. result_pattern_id    — every result carries the correct pattern_id
 *
 * Per-pattern TP / edge / multi-pattern / regression cases live in
 * `category-X/p-X-NNN-fixtures.test.ts` — one detailed file per
 * pattern. The follow-up density issue is tracked in
 * `docs/decisions/log.md` Phase H close.
 */

const SUBJECT_BUILDERS = {
  Tender: tenderSubject,
  Company: companySubject,
  Person: personSubject,
  Project: tenderSubject, // reuse — Project uses event-kind variants of Tender
  Payment: paymentSubject,
} as const;

describe('registry baseline — every pattern', () => {
  it('registry is populated', () => {
    expect(PatternRegistry.count()).toBeGreaterThan(0);
  });

  for (const pattern of PatternRegistry.all()) {
    describe(`${pattern.id}`, () => {
      it('metadata_valid', () => {
        expect(pattern.id).toMatch(/^P-[A-H]-\d{3}$/);
        expect(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']).toContain(pattern.category);
        expect(pattern.subjectKinds.length).toBeGreaterThan(0);
        expect(pattern.defaultPrior).toBeGreaterThanOrEqual(0);
        expect(pattern.defaultPrior).toBeLessThanOrEqual(1);
        expect(pattern.defaultWeight).toBeGreaterThanOrEqual(0);
        expect(pattern.defaultWeight).toBeLessThanOrEqual(1);
        expect(pattern.title_fr.length).toBeGreaterThan(0);
        expect(pattern.title_en.length).toBeGreaterThan(0);
      });

      it('tn_empty_subject', async () => {
        const subjectKind = pattern.subjectKinds[0]!;
        const builder = SUBJECT_BUILDERS[subjectKind];
        const r = await pattern.detect(builder({}), NULL_CTX);
        expect(r.matched).toBe(false);
        expect(r.pattern_id).toBe(pattern.id);
      });

      it('tn_irrelevant_event', async () => {
        const subjectKind = pattern.subjectKinds[0]!;
        const builder = SUBJECT_BUILDERS[subjectKind];
        const r = await pattern.detect(
          builder({ events: [evt('robots', { content: 'User-agent: *' })] }),
          NULL_CTX,
        );
        expect(r.matched).toBe(false);
        expect(r.pattern_id).toBe(pattern.id);
      });

      it('tn_wrong_subject_kind', async () => {
        // Use a subject kind the pattern doesn't handle; PatternRegistry.applicable
        // would filter this out in production, but the pattern itself should
        // still return a non-matching result (defensive).
        const allKinds = ['Tender', 'Company', 'Person', 'Project', 'Payment'] as const;
        const wrong = allKinds.find((k) => !pattern.subjectKinds.includes(k));
        if (!wrong) return; // pattern handles all kinds — skip
        const builder = SUBJECT_BUILDERS[wrong];
        const r = await pattern.detect(builder({}), NULL_CTX);
        expect(r.matched).toBe(false);
      });

      it('result_pattern_id', async () => {
        const subjectKind = pattern.subjectKinds[0]!;
        const builder = SUBJECT_BUILDERS[subjectKind];
        const r = await pattern.detect(builder({}), NULL_CTX);
        expect(r.pattern_id).toBe(pattern.id);
        expect(typeof r.strength).toBe('number');
        expect(r.strength).toBeGreaterThanOrEqual(0);
        expect(r.strength).toBeLessThanOrEqual(1);
        expect(Array.isArray(r.contributing_event_ids)).toBe(true);
        expect(Array.isArray(r.contributing_document_cids)).toBe(true);
      });
    });
  }
});
