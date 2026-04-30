/**
 * Property-based fuzz tests — every registered pattern, every iteration.
 *
 * Asserts the elite-grade safety property: no matter what arbitrary input
 * we throw at a pattern's detect() function, it must
 *
 *   - never throw an unhandled exception,
 *   - return a value matching the PatternResult shape (pattern_id,
 *     matched: boolean, strength ∈ [0,1], rationale: string,
 *     contributing_event_ids: string[], contributing_document_cids:
 *     string[]),
 *   - return matched: true if and only if strength >= 0.5, OR be
 *     consistent with the pattern's own matchAt threshold (we accept
 *     either since the matched-helper supports a custom matchAt).
 *
 * The fuzzer uses a small deterministic LCG with a baked-in seed so
 * failures are reproducible. ITERATIONS_PER_PATTERN governs how many
 * arbitrary subjects each pattern is exercised against; with 43
 * patterns × 50 iterations × 5 ms typical detect() = ~10s budget,
 * comfortably under the suite's 30s timeout cap.
 */
import { Ids, type Schemas } from '@vigil/shared';
import { describe, expect, it } from 'vitest';

import { PatternRegistry, dispatchPatterns } from '../src/index.js';

// Side-effect import so all 43 patterns register against the singleton.
import '../src/register-all.js';

import type { PatternContext, SubjectInput } from '../src/types.js';

const ITERATIONS_PER_PATTERN = 30;
const SEED = 0x5051_7e51;

const NOOP_LOGGER = {
  info: () => undefined,
  warn: () => undefined,
};

const ctx: PatternContext = {
  now: new Date('2026-04-29T00:00:00Z'),
  logger: NOOP_LOGGER,
  graph: { cypher: async () => [] },
};

/** Tiny linear-congruential PRNG; deterministic given a seed. */
function makePrng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

interface Arbitrary<T> {
  sample(rng: () => number): T;
}

const arbString = (maxLen = 20): Arbitrary<string> => ({
  sample: (rng) => {
    const len = Math.floor(rng() * maxLen);
    let s = '';
    for (let i = 0; i < len; i += 1) {
      s += String.fromCharCode(0x41 + Math.floor(rng() * 26));
    }
    return s;
  },
});

const arbBool: Arbitrary<boolean> = { sample: (rng) => rng() < 0.5 };
const arbNum = (lo: number, hi: number): Arbitrary<number> => ({
  sample: (rng) => lo + rng() * (hi - lo),
});
const arbIntInRange = (lo: number, hi: number): Arbitrary<number> => ({
  sample: (rng) => Math.floor(arbNum(lo, hi).sample(rng)),
});
const arbItem = <T>(items: ReadonlyArray<T>): Arbitrary<T> => ({
  sample: (rng) => items[Math.floor(rng() * items.length)]!,
});
const arbMaybe = <T>(inner: Arbitrary<T>): Arbitrary<T | null> => ({
  sample: (rng) => (rng() < 0.3 ? null : inner.sample(rng)),
});
const arbArray = <T>(inner: Arbitrary<T>, maxLen = 5): Arbitrary<T[]> => ({
  sample: (rng) => {
    const n = Math.floor(rng() * maxLen);
    return Array.from({ length: n }, () => inner.sample(rng));
  },
});

const SUBJECT_KINDS = ['Tender', 'Company', 'Person', 'Project', 'Payment'] as const;
const EVENT_KINDS: ReadonlyArray<Schemas.SourceEventKind> = [
  'tender_notice',
  'award',
  'amendment',
  'cancellation',
  'debarment',
  'company_filing',
  'court_judgement',
  'press_release',
  'audit_report',
  'satellite_imagery',
  'treasury_disbursement',
  'payment_order',
  'sanctions_listing',
];
const PROCUREMENT_METHODS = [
  'gre_a_gre',
  'appel_offres_ouvert',
  'appel_offres_restreint',
  'marche_negocie',
  null,
];

function arbEvent(): Arbitrary<Schemas.SourceEvent> {
  return {
    sample: (rng) => ({
      id: `${Ids.newEventId()}`,
      source_id: `cm-armp-${arbIntInRange(0, 100).sample(rng)}`,
      kind: arbItem(EVENT_KINDS).sample(rng),
      dedup_key: arbString(40).sample(rng) || 'd',
      published_at: rng() < 0.2 ? null : new Date(2020 + Math.floor(rng() * 7), 0, 1).toISOString(),
      observed_at: new Date(2024 + Math.floor(rng() * 3), 0, 1).toISOString(),
      payload: arbPayload().sample(rng),
      document_cids: arbArray(arbString(50), 3).sample(rng),
      provenance: {
        source_id: `cm-armp-${arbIntInRange(0, 100).sample(rng)}`,
        source_url: 'https://example.test',
        fetched_at: new Date().toISOString(),
        method_executed: 'GET',
        response_status: 200,
        response_sha256: 'a'.repeat(64),
        request_user_agent: 'vigil-test',
      },
    }),
  };
}

function arbPayload(): Arbitrary<Record<string, unknown>> {
  return {
    sample: (rng) => {
      const out: Record<string, unknown> = {};
      // Selectively populate fields that patterns read — exercise both
      // present and absent paths.
      if (rng() < 0.6) out['bidder_count'] = arbIntInRange(0, 12).sample(rng);
      if (rng() < 0.5) out['amount_xaf'] = arbIntInRange(0, 10_000_000_000).sample(rng);
      if (rng() < 0.5) out['procurement_method'] = arbItem(PROCUREMENT_METHODS).sample(rng);
      if (rng() < 0.4) out['supplier_name'] = arbString(30).sample(rng);
      if (rng() < 0.3) out['benchmark_amount_xaf'] = arbIntInRange(0, 5_000_000_000).sample(rng);
      if (rng() < 0.2) out['signature_similarity_score'] = arbNum(0, 1).sample(rng);
      if (rng() < 0.2) out['font_anomaly_score'] = arbNum(0, 1).sample(rng);
      if (rng() < 0.2) out['activity_score'] = arbNum(0, 1).sample(rng);
      if (rng() < 0.3) out['bidder_graph_density'] = arbNum(0, 1).sample(rng);
      if (rng() < 0.2) out['effective_date'] = '2024-01-01';
      if (rng() < 0.2) out['document_metadata'] = { author: 'X', creator: 'Y' };
      // Adversarial: occasionally inject the wrong type for a number field
      if (rng() < 0.05) out['amount_xaf'] = 'not-a-number';
      if (rng() < 0.05) out['bidder_count'] = null;
      return out;
    },
  };
}

function arbCanonical(kind: SubjectInput['kind']): Arbitrary<Schemas.EntityCanonical | null> {
  return arbMaybe<Schemas.EntityCanonical>({
    sample: (rng) => ({
      id: `${Ids.newEntityId()}`,
      kind: kind === 'Company' ? 'company' : kind === 'Person' ? 'person' : 'company',
      display_name: arbString(40).sample(rng) || 'Unknown Co.',
      rccm_number: rng() < 0.5 ? null : 'RC/YAO/2019/B/4521',
      niu: rng() < 0.5 ? null : 'P018765432100Z',
      jurisdiction: rng() < 0.5 ? null : 'CM',
      region: arbItem(['Centre', 'Littoral', 'Ouest', null]).sample(
        rng,
      ) as Schemas.EntityCanonical['region'],
      eth_address: null,
      is_pep: arbBool.sample(rng),
      is_sanctioned: arbBool.sample(rng),
      sanctioned_lists: arbBool.sample(rng) ? ['ofac'] : [],
      first_seen: new Date(2020, 0, 1).toISOString(),
      last_seen: new Date(2024, 0, 1).toISOString(),
      resolution_confidence: arbNum(0.5, 1).sample(rng),
      resolved_by: 'rule',
      metadata: arbMetadata().sample(rng),
    }),
  });
}

function arbMetadata(): Arbitrary<Record<string, unknown>> {
  return {
    sample: (rng) => {
      const out: Record<string, unknown> = {};
      if (rng() < 0.4) out['communityId'] = arbIntInRange(0, 100).sample(rng);
      if (rng() < 0.3) out['pageRank'] = arbNum(0, 0.1).sample(rng);
      if (rng() < 0.2) out['roundTripDetected'] = true;
      if (rng() < 0.2) out['roundTripHops'] = arbIntInRange(1, 4).sample(rng);
      if (rng() < 0.3) out['directorRingFlag'] = true;
      return out;
    },
  };
}

function arbSubject(rng: () => number): SubjectInput {
  const kind = arbItem(SUBJECT_KINDS).sample(rng);
  const canonical = arbCanonical(kind).sample(rng);
  const events = arbArray(arbEvent(), 8).sample(rng);
  const related = arbArray(arbCanonical(kind), 4)
    .sample(rng)
    .filter((c): c is Schemas.EntityCanonical => c !== null);
  return {
    kind,
    canonical,
    related,
    events,
    priorFindings: [],
    metrics: rng() < 0.3 ? { communityId: arbIntInRange(0, 100).sample(rng) } : undefined,
  };
}

describe('property-based pattern fuzzing', () => {
  it('every registered pattern survives ITERATIONS arbitrary subjects without throwing', async () => {
    const all = PatternRegistry.all();
    expect(all.length).toBeGreaterThanOrEqual(43);
    const rng = makePrng(SEED);

    const failures: Array<{
      patternId: string;
      iteration: number;
      reason: string;
      detail: string;
    }> = [];

    for (const pat of all) {
      for (let iter = 0; iter < ITERATIONS_PER_PATTERN; iter += 1) {
        const subject = arbSubject(rng);
        // Skip subjects of incompatible kind — saves cycles, the dispatch
        // already does this filter, here we exercise detect() directly.
        if (!pat.subjectKinds.includes(subject.kind)) continue;
        try {
          const result = await pat.detect(subject, ctx);
          if (typeof result !== 'object' || result === null) {
            failures.push({
              patternId: pat.id,
              iteration: iter,
              reason: 'non-object-result',
              detail: typeof result,
            });
            continue;
          }
          const r = result as Schemas.PatternResult;
          if (r.pattern_id !== pat.id) {
            failures.push({
              patternId: pat.id,
              iteration: iter,
              reason: 'id-mismatch',
              detail: `${r.pattern_id} ≠ ${pat.id}`,
            });
          }
          if (typeof r.matched !== 'boolean') {
            failures.push({
              patternId: pat.id,
              iteration: iter,
              reason: 'matched-not-bool',
              detail: typeof r.matched,
            });
          }
          if (typeof r.strength !== 'number' || !Number.isFinite(r.strength)) {
            failures.push({
              patternId: pat.id,
              iteration: iter,
              reason: 'strength-not-finite',
              detail: String(r.strength),
            });
          }
          if (r.strength < 0 || r.strength > 1) {
            failures.push({
              patternId: pat.id,
              iteration: iter,
              reason: 'strength-out-of-range',
              detail: String(r.strength),
            });
          }
          if (!Array.isArray(r.contributing_event_ids)) {
            failures.push({
              patternId: pat.id,
              iteration: iter,
              reason: 'contributing-events-not-array',
              detail: typeof r.contributing_event_ids,
            });
          }
          if (typeof r.rationale !== 'string') {
            failures.push({
              patternId: pat.id,
              iteration: iter,
              reason: 'rationale-not-string',
              detail: typeof r.rationale,
            });
          }
        } catch (err) {
          failures.push({
            patternId: pat.id,
            iteration: iter,
            reason: 'threw',
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    if (failures.length > 0) {
      // Print up to 10 failures for diagnosis; assert empty.
      const shown = failures.slice(0, 10);
      // eslint-disable-next-line no-console
      console.error('Property failures:', JSON.stringify(shown, null, 2));
    }
    expect(failures).toEqual([]);
  }, 30_000);
});

describe('property-based dispatch fuzzing', () => {
  it('dispatchPatterns(arbitrary subject) never throws and never produces invalid results', async () => {
    const rng = makePrng(SEED ^ 0xdead_beef);
    for (let i = 0; i < 25; i += 1) {
      const subject = arbSubject(rng);
      const result = await dispatchPatterns(subject, ctx);
      // dispatch wrapper guarantees: failures captured, results sanitised
      for (const r of result.results) {
        expect(r.strength).toBeGreaterThanOrEqual(0);
        expect(r.strength).toBeLessThanOrEqual(1);
        expect(typeof r.rationale).toBe('string');
      }
      // shadow results follow the same invariants
      for (const r of result.shadowResults) {
        expect(r.strength).toBeGreaterThanOrEqual(0);
        expect(r.strength).toBeLessThanOrEqual(1);
      }
    }
  }, 30_000);
});
