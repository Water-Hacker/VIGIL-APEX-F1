/**
 * Pattern dispatch — hardening contract tests.
 *
 * Asserts the elite-grade safety properties: no-throw, timeout-respect,
 * subject-kind gating, status partitioning, deterministic ordering,
 * provenance stamping, and runtime result-shape validation.
 *
 * Uses the dispatch's `patterns` injection point to avoid coupling to the
 * singleton PatternRegistry — keeps test isolation clean.
 */
import { Ids, type Schemas } from '@vigil/shared';
import { describe, expect, it } from 'vitest';

import {
  dispatchPatterns,
  PatternRegistry,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
} from '../src/index.js';

import type { PatternContext, PatternDef, SubjectInput } from '../src/types.js';

const NOOP_LOGGER = {
  info: (_m: string, _c?: unknown) => undefined,
  warn: (_m: string, _c?: unknown) => undefined,
};

const ctxStub: PatternContext = {
  now: new Date('2026-04-29T00:00:00Z'),
  logger: NOOP_LOGGER,
  graph: { cypher: async () => [] },
};

function makeSubject(overrides: Partial<SubjectInput> = {}): SubjectInput {
  return {
    kind: 'Tender',
    canonical: null,
    related: [],
    events: [],
    priorFindings: [],
    ...overrides,
  };
}

// We need to use a valid pattern-id format (P-[A-H]-NNN). Re-use real
// pattern ids that exist in the registry — but inject our own detect
// implementations via the `patterns` option so we don't actually run
// the production patterns. The id collision is therefore harmless
// because we never touch the global registry.
function fakePattern(opts: {
  id: string;
  status?: 'live' | 'shadow' | 'deprecated';
  subjectKind?: 'Tender' | 'Company';
  detect?: PatternDef['detect'];
}): PatternDef {
  return {
    id: Ids.asPatternId(opts.id),
    category: 'A',
    subjectKinds: [opts.subjectKind ?? 'Tender'],
    title_fr: 'test',
    title_en: 'test',
    description_fr: 'test',
    description_en: 'test',
    defaultPrior: 0.1,
    defaultWeight: 0.5,
    status: opts.status ?? 'live',
    detect:
      opts.detect ??
      (async () => ({
        pattern_id: Ids.asPatternId(opts.id),
        matched: false,
        strength: 0,
        contributing_event_ids: [],
        contributing_document_cids: [],
        rationale: 'noop',
      })),
  };
}

describe('dispatchPatterns — no-throw guarantee', () => {
  it('captures a pattern that throws and continues with the others', async () => {
    const result = await dispatchPatterns(makeSubject(), ctxStub, {
      patterns: [
        fakePattern({
          id: 'P-A-001',
          detect: async () => {
            throw new Error('intentional bug');
          },
        }),
        fakePattern({
          id: 'P-A-002',
          detect: async () => ({
            pattern_id: Ids.asPatternId('P-A-002'),
            matched: true,
            strength: 0.8,
            contributing_event_ids: [],
            contributing_document_cids: [],
            rationale: 'works',
          }),
        }),
      ],
    });
    const failure = result.failures.find((f) => f.patternId === 'P-A-001');
    expect(failure).toBeDefined();
    expect(failure?.reason).toBe('threw');
    expect(failure?.detail).toContain('intentional bug');

    const success = result.results.find((r) => r.pattern_id === 'P-A-002');
    expect(success).toBeDefined();
    expect(success?.matched).toBe(true);
  });
});

describe('dispatchPatterns — resource budget', () => {
  it('cancels a pattern that exceeds the timeout', async () => {
    const start = Date.now();
    const result = await dispatchPatterns(makeSubject(), ctxStub, {
      timeoutMs: 100,
      patterns: [
        fakePattern({
          id: 'P-A-003',
          detect: async () =>
            new Promise<Schemas.PatternResult>((resolve) => {
              setTimeout(() => {
                resolve({
                  pattern_id: Ids.asPatternId('P-A-003'),
                  matched: false,
                  strength: 0,
                  contributing_event_ids: [],
                  contributing_document_cids: [],
                  rationale: 'too late',
                });
              }, 5000);
            }),
        }),
      ],
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
    expect(result.failures[0]?.reason).toBe('timeout');
  }, 10_000);
});

describe('dispatchPatterns — invalid result detection', () => {
  it('rejects a pattern that returns the wrong shape', async () => {
    const result = await dispatchPatterns(makeSubject(), ctxStub, {
      patterns: [
        fakePattern({
          id: 'P-A-004',
          detect: async () => ({ wrong: 'shape' }) as unknown as Schemas.PatternResult,
        }),
      ],
    });
    expect(result.failures[0]?.reason).toBe('invalid-result');
  });

  it('rejects strength > 1', async () => {
    const result = await dispatchPatterns(makeSubject(), ctxStub, {
      patterns: [
        fakePattern({
          id: 'P-A-005',
          detect: async () => ({
            pattern_id: Ids.asPatternId('P-A-005'),
            matched: true,
            strength: 1.5,
            contributing_event_ids: [],
            contributing_document_cids: [],
            rationale: 'over',
          }),
        }),
      ],
    });
    expect(result.failures[0]?.reason).toBe('invalid-result');
  });
});

describe('dispatchPatterns — subject-kind gate', () => {
  it('does not invoke patterns whose subjectKinds exclude the subject kind', async () => {
    let called = false;
    await dispatchPatterns(makeSubject({ kind: 'Tender' }), ctxStub, {
      patterns: [
        fakePattern({
          id: 'P-A-006',
          subjectKind: 'Company',
          detect: async () => {
            called = true;
            return {
              pattern_id: Ids.asPatternId('P-A-006'),
              matched: false,
              strength: 0,
              contributing_event_ids: [],
              contributing_document_cids: [],
              rationale: 'company-only',
            };
          },
        }),
      ],
    });
    expect(called).toBe(false);
  });
});

describe('dispatchPatterns — status partitioning', () => {
  it('routes shadow patterns into shadowResults', async () => {
    const result = await dispatchPatterns(makeSubject(), ctxStub, {
      patterns: [
        fakePattern({
          id: 'P-A-007',
          status: 'shadow',
          detect: async () => ({
            pattern_id: Ids.asPatternId('P-A-007'),
            matched: true,
            strength: 0.7,
            contributing_event_ids: [],
            contributing_document_cids: [],
            rationale: 'shadow-fire',
          }),
        }),
      ],
    });
    expect(result.results.length).toBe(0);
    expect(result.shadowResults.length).toBe(1);
    expect(result.shadowResults[0]?.dispatch_pattern_status).toBe('shadow');
  });

  it('drops deprecated patterns entirely', async () => {
    const result = await dispatchPatterns(makeSubject(), ctxStub, {
      patterns: [
        fakePattern({
          id: 'P-A-008',
          status: 'deprecated',
        }),
      ],
    });
    expect(result.results.length).toBe(0);
    expect(result.shadowResults.length).toBe(0);
    expect(result.failures.length).toBe(0);
  });
});

describe('dispatchPatterns — provenance stamping', () => {
  it('annotates every result with dispatch_timing_ms and dispatch_pattern_status', async () => {
    const result = await dispatchPatterns(makeSubject(), ctxStub, {
      patterns: [
        fakePattern({
          id: 'P-A-009',
          detect: async () => ({
            pattern_id: Ids.asPatternId('P-A-009'),
            matched: true,
            strength: 0.9,
            contributing_event_ids: [],
            contributing_document_cids: [],
            rationale: 'ok',
          }),
        }),
      ],
    });
    const r = result.results[0];
    expect(r).toBeDefined();
    expect(typeof r?.dispatch_timing_ms).toBe('number');
    expect(r?.dispatch_pattern_status).toBe('live');
  });
});

describe('dispatchPatterns — deterministic ordering', () => {
  it('returns results sorted by pattern_id', async () => {
    const detect =
      (id: string): PatternDef['detect'] =>
      async () => ({
        pattern_id: Ids.asPatternId(id),
        matched: true,
        strength: 0.6,
        contributing_event_ids: [],
        contributing_document_cids: [],
        rationale: id,
      });
    const result = await dispatchPatterns(makeSubject(), ctxStub, {
      patterns: [
        fakePattern({ id: 'P-B-002', detect: detect('P-B-002') }),
        fakePattern({ id: 'P-A-001', detect: detect('P-A-001') }),
        fakePattern({ id: 'P-A-002', detect: detect('P-A-002') }),
      ],
    });
    expect(result.results.map((r) => r.pattern_id)).toEqual(['P-A-001', 'P-A-002', 'P-B-002']);
  });
});

describe('payload accessors — defense in depth', () => {
  it('readNumber returns null for non-numbers', () => {
    expect(readNumber({ x: 'string' }, 'x')).toBeNull();
    expect(readNumber({ x: NaN }, 'x')).toBeNull();
    expect(readNumber({}, 'missing')).toBeNull();
    expect(readNumber({ x: 42 }, 'x')).toBe(42);
  });
  it('readString rejects empty strings', () => {
    expect(readString({ x: '' }, 'x')).toBeNull();
    expect(readString({ x: 'value' }, 'x')).toBe('value');
  });
  it('readBoolean is strict about type', () => {
    expect(readBoolean({ x: 'true' }, 'x')).toBeNull();
    expect(readBoolean({ x: 1 }, 'x')).toBeNull();
    expect(readBoolean({ x: true }, 'x')).toBe(true);
  });
  it('readStringArray filters non-string elements', () => {
    expect(readStringArray({ x: ['a', 1, 'b'] }, 'x')).toEqual(['a', 'b']);
    expect(readStringArray({ x: [] }, 'x')).toBeNull();
    expect(readStringArray({ x: 'not-an-array' }, 'x')).toBeNull();
  });
});

describe('PatternRegistry — singleton fallback', () => {
  it('exposes applicableTo() the dispatch consults when no patterns option is passed', () => {
    expect(typeof PatternRegistry.applicableTo).toBe('function');
  });
});

describe('AUDIT-059 — pattern dispatch emits per-outcome timing histogram', () => {
  it('observes the ok branch with outcome="ok" on a successful detect', async () => {
    const { patternEvalDurationMs } = await import('@vigil/observability');
    // Reset counts so this test stands on its own. prom-client doesn't
    // expose a per-label reset; we read the snapshot before/after instead.
    const before = await patternEvalDurationMs.get();
    const okBefore = countOutcomeSamples(before, 'P-A-001', 'ok');

    await dispatchPatterns(makeSubject(), ctxStub, {
      patterns: [fakePattern({ id: 'P-A-001' })],
    });

    const after = await patternEvalDurationMs.get();
    const okAfter = countOutcomeSamples(after, 'P-A-001', 'ok');
    expect(okAfter - okBefore).toBe(1);
  });

  it('observes outcome="timeout" on a pattern that exceeds its budget', async () => {
    const { patternEvalDurationMs } = await import('@vigil/observability');
    const before = await patternEvalDurationMs.get();
    const tBefore = countOutcomeSamples(before, 'P-A-002', 'timeout');

    await dispatchPatterns(makeSubject(), ctxStub, {
      timeoutMs: 5,
      patterns: [
        fakePattern({
          id: 'P-A-002',
          detect: () => new Promise(() => undefined),
        }),
      ],
    });

    const after = await patternEvalDurationMs.get();
    const tAfter = countOutcomeSamples(after, 'P-A-002', 'timeout');
    expect(tAfter - tBefore).toBe(1);
  });

  it('observes outcome="error" when the pattern throws', async () => {
    const { patternEvalDurationMs } = await import('@vigil/observability');
    const before = await patternEvalDurationMs.get();
    const eBefore = countOutcomeSamples(before, 'P-A-003', 'error');

    await dispatchPatterns(makeSubject(), ctxStub, {
      patterns: [
        fakePattern({
          id: 'P-A-003',
          detect: async () => {
            throw new Error('boom');
          },
        }),
      ],
    });

    const after = await patternEvalDurationMs.get();
    const eAfter = countOutcomeSamples(after, 'P-A-003', 'error');
    expect(eAfter - eBefore).toBe(1);
  });
});

function countOutcomeSamples(
  snapshot: {
    values: ReadonlyArray<{
      metricName?: string;
      labels: Record<string, string | number>;
      value: number;
    }>;
  },
  patternId: string,
  outcome: string,
): number {
  for (const v of snapshot.values) {
    if (
      v.metricName === 'vigil_pattern_eval_duration_ms_count' &&
      v.labels.pattern_id === patternId &&
      v.labels.outcome === outcome
    ) {
      return v.value;
    }
  }
  return 0;
}
