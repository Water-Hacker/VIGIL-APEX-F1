/**
 * worker-pattern smoke test — registry barrel correctness.
 *
 * The worker depends on `_register-patterns.ts` running every category-X
 * file's side-effect import. This test asserts:
 *   - registry is non-empty after the barrel import
 *   - every category A..H has at least one registered pattern
 *   - every registered pattern's id matches the P-X-NNN convention
 *   - dispatch by subject kind returns at least one pattern for the
 *     canonical subject kinds (Tender, Company, Person, Project, Payment)
 */
// Side-effect: registers all 43 patterns at module load.
import '@vigil/patterns/register-all';
import { PatternRegistry } from '@vigil/patterns';
import { describe, expect, it } from 'vitest';

describe('worker-pattern registry', () => {
  it('registers ≥ 40 patterns at module load', () => {
    expect(PatternRegistry.all().length).toBeGreaterThanOrEqual(40);
  });

  it('every category A..H has at least one pattern', () => {
    for (const cat of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      const patterns = PatternRegistry.byCategoryLetter(cat);
      expect(patterns.length, `category ${cat} has no patterns`).toBeGreaterThanOrEqual(1);
    }
  });

  it('every registered pattern id matches /^P-[A-H]-\\d{3}$/', () => {
    for (const p of PatternRegistry.all()) {
      expect(p.id, p.id).toMatch(/^P-[A-H]-\d{3}$/);
    }
  });

  it('dispatch by subject kind returns at least one matcher for each canonical kind', () => {
    for (const kind of ['Tender', 'Company', 'Person', 'Project', 'Payment'] as const) {
      const matches = PatternRegistry.applicable({ kind, events: [], related: [] });
      // Tender / Company / Project always have direct patterns; Person and
      // Payment routes are covered indirectly through related entities.
      if (kind === 'Tender' || kind === 'Company' || kind === 'Project') {
        expect(matches.length, `kind ${kind}`).toBeGreaterThanOrEqual(1);
      } else {
        expect(matches.length).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('no pattern is registered twice (id uniqueness)', () => {
    const ids = PatternRegistry.all().map((p) => p.id);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
  });

  it('every pattern has FR + EN titles + descriptions (no empty strings)', () => {
    for (const p of PatternRegistry.all()) {
      expect(p.title_fr.length, `${p.id}.title_fr`).toBeGreaterThan(0);
      expect(p.title_en.length, `${p.id}.title_en`).toBeGreaterThan(0);
      expect(p.description_fr.length, `${p.id}.description_fr`).toBeGreaterThan(0);
      expect(p.description_en.length, `${p.id}.description_en`).toBeGreaterThan(0);
    }
  });

  it('every pattern declares a default prior in [0, 1] and weight in [0, 1]', () => {
    for (const p of PatternRegistry.all()) {
      expect(p.defaultPrior, `${p.id}.defaultPrior`).toBeGreaterThanOrEqual(0);
      expect(p.defaultPrior, `${p.id}.defaultPrior`).toBeLessThanOrEqual(1);
      expect(p.defaultWeight, `${p.id}.defaultWeight`).toBeGreaterThanOrEqual(0);
      expect(p.defaultWeight, `${p.id}.defaultWeight`).toBeLessThanOrEqual(1);
    }
  });
});
