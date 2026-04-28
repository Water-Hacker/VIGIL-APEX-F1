import { describe, it, expect } from 'vitest';

import type { PatternDef, PatternContext, SubjectInput } from '../src/types.js';

/**
 * Test harness for the 43-pattern fixture suite (Phase H4).
 *
 * Each pattern file under `test/category-X/p-X-NNN-fixtures.ts`
 * imports its pattern's default-exported `PatternDef` and uses
 * `runPatternFixtures()` to drive a Vitest describe-block.
 *
 * Fixture shape names map onto the architect's required cases:
 *   TP          — true positive (matched=true, strength ≥ default)
 *   TN          — true negative (matched=false)
 *   edge        — boundary condition (e.g. exactly the threshold)
 *   multi       — pattern co-occurs with another finding signal
 *   regression  — bug we previously closed; locks the fix
 */

export type FixtureKind = 'TP' | 'TN' | 'edge' | 'multi' | 'regression';

export interface PatternFixture {
  readonly name: string;
  readonly kind: FixtureKind;
  readonly subject: SubjectInput;
  readonly expect: {
    readonly matched: boolean;
    readonly minStrength?: number;
    readonly maxStrength?: number;
    readonly mustCiteEventId?: string;
    readonly mustMentionInRationale?: string;
  };
}

export const NULL_CTX: PatternContext = {
  now: new Date('2026-04-28T13:00:00Z'),
  logger: {
    info: () => undefined,
    warn: () => undefined,
  },
  graph: {
    cypher: async <T extends Record<string, unknown>>(): Promise<T[]> => [],
  },
};

export function runPatternFixtures(
  pattern: PatternDef,
  fixtures: ReadonlyArray<PatternFixture>,
): void {
  describe(`${pattern.id} ${pattern.title_en}`, () => {
    it('has at least 5 fixtures covering the architect-required shapes', () => {
      expect(fixtures.length).toBeGreaterThanOrEqual(5);
      const kinds = new Set(fixtures.map((f) => f.kind));
      expect(kinds.has('TP')).toBe(true);
      expect(kinds.has('TN')).toBe(true);
    });

    for (const fix of fixtures) {
      it(`${fix.kind} — ${fix.name}`, async () => {
        const result = await pattern.detect(fix.subject, NULL_CTX);
        expect(result.pattern_id).toBe(pattern.id);
        expect(result.matched).toBe(fix.expect.matched);
        if (fix.expect.minStrength !== undefined) {
          expect(result.strength).toBeGreaterThanOrEqual(fix.expect.minStrength);
        }
        if (fix.expect.maxStrength !== undefined) {
          expect(result.strength).toBeLessThanOrEqual(fix.expect.maxStrength);
        }
        if (fix.expect.mustCiteEventId !== undefined) {
          expect(result.contributing_event_ids).toContain(fix.expect.mustCiteEventId);
        }
        if (fix.expect.mustMentionInRationale !== undefined) {
          expect(result.rationale.toLowerCase()).toContain(
            fix.expect.mustMentionInRationale.toLowerCase(),
          );
        }
      });
    }
  });
}

/**
 * Subject-builder helpers — keep individual fixtures terse. Defaults
 * use a fixed Cameroun-region tender as the canonical context, which
 * matches the SRD's "primary subject = Tender" convention.
 */
export function tenderSubject(overrides: Partial<SubjectInput> = {}): SubjectInput {
  return {
    kind: 'Tender',
    canonical: null,
    related: [],
    events: [],
    priorFindings: [],
    ...overrides,
  };
}

export function companySubject(overrides: Partial<SubjectInput> = {}): SubjectInput {
  return {
    kind: 'Company',
    canonical: null,
    related: [],
    events: [],
    priorFindings: [],
    ...overrides,
  };
}

export function personSubject(overrides: Partial<SubjectInput> = {}): SubjectInput {
  return {
    kind: 'Person',
    canonical: null,
    related: [],
    events: [],
    priorFindings: [],
    ...overrides,
  };
}

export function paymentSubject(overrides: Partial<SubjectInput> = {}): SubjectInput {
  return {
    kind: 'Payment',
    canonical: null,
    related: [],
    events: [],
    priorFindings: [],
    ...overrides,
  };
}

/**
 * Make a SourceEvent shell. Most fixtures pass payload only; this
 * helper fills in the cryptographic boilerplate so each fixture stays
 * focused on the pattern logic under test.
 */
let _eventCounter = 0;
export function evt(
  kind: string,
  payload: Record<string, unknown>,
  opts: {
    id?: string;
    sourceId?: string;
    publishedAt?: string;
    documentCids?: ReadonlyArray<string>;
  } = {},
): import('@vigil/shared').Schemas.SourceEvent {
  _eventCounter += 1;
  return {
    id: opts.id ?? `00000000-0000-4000-a000-${_eventCounter.toString().padStart(12, '0')}`,
    source_id: (opts.sourceId ?? 'test-fixture') as import('@vigil/shared').Schemas.SourceEvent['source_id'],
    kind: kind as import('@vigil/shared').Schemas.SourceEvent['kind'],
    dedup_key: `fixture:${_eventCounter}`,
    published_at: (opts.publishedAt ?? '2026-04-01T10:00:00Z') as import('@vigil/shared').Schemas.SourceEvent['published_at'],
    observed_at: '2026-04-01T10:00:00Z',
    payload,
    document_cids: [...(opts.documentCids ?? [])],
    provenance: {
      url: 'https://test.fixture/example',
      http_status: 200,
      response_sha256: 'a'.repeat(64),
      fetched_via_proxy: null,
      user_agent: 'vigil-test/1.0',
    },
  };
}
