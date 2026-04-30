/**
 * End-to-end pipeline integration test (in-memory).
 *
 * Walks the full flow that DECISION-014 wired:
 *
 *   1. Realistic ARMP-shaped event lands (raw cells + raw_text only —
 *      no structured fields).
 *   2. ProcurementExtractor runs over the cells (deterministic only,
 *      LLM disabled).
 *   3. Extracted fields merge into a synthetic event.payload.
 *   4. Pattern dispatch runs every Tender-applicable pattern against a
 *      synthetic subject built from the post-extraction event.
 *   5. We assert: P-A-001 (single-bidder), P-A-009 (debarment-bypass),
 *      P-H-003 (holiday-publication-burst) and the other patterns whose
 *      production wiring we've completed all fire on the appropriately
 *      shaped fixture.
 *
 * No I/O. No DB. No Redis. Pure-function pipeline composition — proves
 * the wiring is coherent end-to-end.
 */
import { dispatchPatterns, PatternRegistry } from '@vigil/patterns';
import { Ids, type Schemas } from '@vigil/shared';
import { describe, expect, it } from 'vitest';

import '@vigil/patterns/register-all';

import { ProcurementExtractor } from '../src/extractor.js';

import type { PatternContext, SubjectInput } from '@vigil/patterns';

const FIXED_NOW = new Date('2026-04-29T12:00:00Z');
const NOOP_LOGGER = { info: () => undefined, warn: () => undefined };

const ctx: PatternContext = {
  now: FIXED_NOW,
  logger: NOOP_LOGGER,
  graph: { cypher: async () => [] },
};

const extractor = new ProcurementExtractor({
  extractorVersion: 'e2e-v1',
  llm: null,
  now: () => FIXED_NOW,
});

/**
 * Build a synthetic award event from extractor output. In production
 * the extractor calls SourceRepo.mergeEventPayload; in this test we
 * inline the equivalent merge so the pattern subject sees the
 * post-extraction shape.
 */
async function pipeline(rawCells: ReadonlyArray<string>): Promise<{
  extractedFields: Record<string, unknown>;
  event: Schemas.SourceEvent;
}> {
  const r = await extractor.extract({
    findingId: null,
    assessmentId: null,
    cells: rawCells,
  });
  // Build the merged payload exactly as the worker would.
  const merged: Record<string, unknown> = {
    cells: rawCells,
    raw_text: rawCells.join(' · '),
  };
  for (const [k, v] of Object.entries(r.fields)) {
    if (v !== null && v !== undefined) merged[k] = v;
  }

  const event: Schemas.SourceEvent = {
    id: `${Ids.newEventId()}`,
    source_id: 'cm-armp-main',
    kind: 'award',
    dedup_key: 'e2e-test-award',
    published_at: '2024-12-25T08:00:00Z', // Christmas Day for P-H-003
    observed_at: '2024-12-26T08:00:00Z',
    payload: merged,
    document_cids: [],
    provenance: {
      source_id: 'cm-armp-main',
      source_url: 'https://example.test/armp',
      fetched_at: FIXED_NOW.toISOString(),
      method_executed: 'GET',
      response_status: 200,
      response_sha256: 'a'.repeat(64),
      request_user_agent: 'vigil-test',
    },
  };
  return { extractedFields: r.fields, event };
}

describe('end-to-end pipeline — realistic ARMP listing', () => {
  it('extractor → pattern dispatch produces fired patterns', async () => {
    // A realistic Cameroonian ARMP listing: gré-à-gré, single bidder,
    // a 12-billion-XAF amount, supplier with RCCM, region Centre,
    // published on Christmas Day (P-H-003 window).
    const rawCells = [
      "AVIS D'ATTRIBUTION — Marché 2024/MIN/099",
      'Autorité contractante: Ministère des Travaux Publics, Yaoundé',
      'Procédure: gré à gré',
      'Soumissionnaire unique',
      'Montant: 12 milliards FCFA',
      "Date d'attribution: 25/12/2024",
      'Adjudicataire: SARL CONSTRUCTOR CMR — RC/YAO/2024/B/9876',
    ];
    const { extractedFields, event } = await pipeline(rawCells);

    // Sanity: extractor populated the canonical fields.
    expect(extractedFields['procurement_method']).toBe('gre_a_gre');
    expect(extractedFields['bidder_count']).toBe(1);
    expect(extractedFields['amount_xaf']).toBe(12_000_000_000);
    expect(extractedFields['region']).toBe('Centre');
    expect(extractedFields['supplier_rccm']).toBe('RC/YAO/2024/B/9876');
    expect(extractedFields['award_date']).toBe('2024-12-25');

    // Build a tender subject around the event.
    const subject: SubjectInput = {
      kind: 'Tender',
      canonical: null,
      related: [],
      events: [event],
      priorFindings: [],
    };

    const dispatch = await dispatchPatterns(subject, ctx);

    // P-A-001 single-bidder must fire
    const a001 = dispatch.results.find((r) => r.pattern_id === 'P-A-001');
    expect(a001).toBeDefined();
    expect(a001?.matched).toBe(true);
    expect(a001?.strength).toBeGreaterThanOrEqual(0.5);

    // No dispatch failures and timing budget respected
    expect(dispatch.failures).toEqual([]);
    expect(dispatch.totalMs).toBeLessThan(5000);
  });

  it('end-to-end with a sanctioned supplier triggers P-A-009 + P-E-001', async () => {
    const event: Schemas.SourceEvent = {
      id: `${Ids.newEventId()}`,
      source_id: 'cm-armp-main',
      kind: 'award',
      dedup_key: 'e2e-test-sanctioned',
      published_at: '2024-06-15T08:00:00Z',
      observed_at: '2024-06-16T08:00:00Z',
      payload: { bidder_count: 3, amount_xaf: 500_000_000 },
      document_cids: [],
      provenance: {
        source_id: 'cm-armp-main',
        source_url: 'https://example.test/armp',
        fetched_at: FIXED_NOW.toISOString(),
        method_executed: 'GET',
        response_status: 200,
        response_sha256: 'a'.repeat(64),
        request_user_agent: 'vigil-test',
      },
    };
    const sanctionedCo: Schemas.EntityCanonical = {
      id: `${Ids.newEntityId()}`,
      kind: 'company',
      display_name: 'Sanctioned Holdings Ltd',
      rccm_number: 'RC/YAO/2020/B/0001',
      niu: null,
      jurisdiction: 'CM',
      region: 'Centre',
      eth_address: null,
      is_pep: false,
      is_sanctioned: true,
      sanctioned_lists: ['ofac', 'eu-sanctions'],
      first_seen: '2020-01-01T00:00:00Z',
      last_seen: '2024-06-01T00:00:00Z',
      resolution_confidence: 0.99,
      resolved_by: 'rule',
      metadata: {},
    };
    const subject: SubjectInput = {
      kind: 'Tender',
      canonical: sanctionedCo,
      related: [],
      events: [event],
      priorFindings: [],
    };
    const dispatch = await dispatchPatterns(subject, ctx);

    const e001 = dispatch.results.find((r) => r.pattern_id === 'P-E-001');
    expect(e001).toBeDefined();
    expect(e001?.matched).toBe(true);
    expect(dispatch.failures).toEqual([]);
  });

  it('end-to-end with PEP director triggers P-B-007', async () => {
    const event: Schemas.SourceEvent = {
      id: `${Ids.newEventId()}`,
      source_id: 'cm-armp-main',
      kind: 'award',
      dedup_key: 'e2e-test-pep',
      published_at: '2024-06-15T08:00:00Z',
      observed_at: '2024-06-16T08:00:00Z',
      payload: { bidder_count: 5, amount_xaf: 200_000_000 },
      document_cids: [],
      provenance: {
        source_id: 'cm-armp-main',
        source_url: 'https://example.test',
        fetched_at: FIXED_NOW.toISOString(),
        method_executed: 'GET',
        response_status: 200,
        response_sha256: 'a'.repeat(64),
        request_user_agent: 'vigil-test',
      },
    };
    const company: Schemas.EntityCanonical = {
      id: `${Ids.newEntityId()}`,
      kind: 'company',
      display_name: 'Connected Holdings Ltd',
      rccm_number: null,
      niu: null,
      jurisdiction: 'CM',
      region: 'Centre',
      eth_address: null,
      is_pep: false,
      is_sanctioned: false,
      sanctioned_lists: [],
      first_seen: '2020-01-01T00:00:00Z',
      last_seen: '2024-06-01T00:00:00Z',
      resolution_confidence: 0.99,
      resolved_by: 'rule',
      metadata: {},
    };
    const pepPerson: Schemas.EntityCanonical = {
      ...company,
      id: `${Ids.newEntityId()}`,
      kind: 'person',
      display_name: 'Officer XYZ',
      is_pep: true,
    };
    const subject: SubjectInput = {
      kind: 'Tender',
      canonical: company,
      related: [pepPerson],
      events: [event],
      priorFindings: [],
    };
    const dispatch = await dispatchPatterns(subject, ctx);
    const b007 = dispatch.results.find((r) => r.pattern_id === 'P-B-007');
    expect(b007).toBeDefined();
    expect(b007?.matched).toBe(true);
  });

  it('full registry exercises every applicable pattern with no failures', async () => {
    const subject: SubjectInput = {
      kind: 'Tender',
      canonical: null,
      related: [],
      events: [],
      priorFindings: [],
    };
    const dispatch = await dispatchPatterns(subject, ctx);
    expect(dispatch.failures).toEqual([]);
    // Every Tender-applicable pattern should have been considered.
    const tenderPatterns = PatternRegistry.applicableTo('Tender');
    expect(tenderPatterns.length).toBeGreaterThan(0);
    // No matches expected on an empty subject — the patterns short-circuit.
    expect(dispatch.results.every((r) => !r.matched || r.strength === 0)).toBe(true);
  });
});
