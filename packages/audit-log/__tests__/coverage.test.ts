import { describe, expect, it } from 'vitest';

import { Schemas } from '@vigil/shared';

describe('TAL-PA event-type taxonomy coverage', () => {
  it('every category has at least one declared event type', () => {
    for (const cat of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] as const) {
      const slugs = (Schemas.KNOWN_EVENT_TYPES as Record<string, readonly string[]>)[cat];
      expect(slugs).toBeDefined();
      expect(slugs!.length).toBeGreaterThan(0);
    }
  });

  it('every declared event type matches the category-of resolver', () => {
    for (const [cat, slugs] of Object.entries(Schemas.KNOWN_EVENT_TYPES) as Array<
      [Schemas.AuditCategory, readonly string[]]
    >) {
      for (const s of slugs) {
        expect(Schemas.categoryOf(s), `categoryOf("${s}") should be ${cat}`).toBe(cat);
      }
    }
  });

  it('every declared event type passes the EVENT_TYPE_RE regex', () => {
    for (const slugs of Object.values(Schemas.KNOWN_EVENT_TYPES)) {
      for (const s of slugs) {
        expect(s).toMatch(Schemas.EVENT_TYPE_RE);
      }
    }
  });

  it('every high-significance event_type is a real registered slug', () => {
    const allKnown = new Set<string>(
      Object.values(Schemas.KNOWN_EVENT_TYPES).flatMap((arr) => Array.from(arr as readonly string[])),
    );
    for (const slug of Schemas.HIGH_SIGNIFICANCE_EVENT_TYPES) {
      expect(allKnown.has(slug), `high-sig slug ${slug} should be in KNOWN_EVENT_TYPES`).toBe(true);
    }
  });

  it('isHighSignificance / categoryOf return null / false for unknown slugs', () => {
    expect(Schemas.isHighSignificance('made_up.thing')).toBe(false);
    expect(Schemas.categoryOf('totally.unknown')).toBe(null);
  });

  it('declares the documented total of approximately 60-80 event subtypes', () => {
    const total = Object.values(Schemas.KNOWN_EVENT_TYPES).reduce(
      (n, arr) => n + (arr as readonly string[]).length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(50);
    expect(total).toBeLessThanOrEqual(120);
  });
});
