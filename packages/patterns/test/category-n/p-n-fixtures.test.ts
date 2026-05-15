import pnDepth from '../../src/category-n/p-n-001-nominee-chain-depth.js';
import pnUbo from '../../src/category-n/p-n-002-recent-ubo-change.js';
import pnHaven from '../../src/category-n/p-n-003-haven-no-substance.js';
import pnControl from '../../src/category-n/p-n-004-control-via-class-shares.js';
import { companySubject, evt, runPatternFixtures, type PatternFixture } from '../_harness.js';

import type { Schemas } from '@vigil/shared';

function canon(metadata: Record<string, unknown>): Schemas.EntityCanonical {
  return {
    id: '00000000-0000-4000-a000-c00000000004',
    kind: 'Company',
    display_name: 'N-Test',
    rccm_number: null,
    niu: null,
    jurisdiction: 'CMR',
    region: 'CE',
    eth_address: null,
    is_pep: false,
    is_sanctioned: false,
    sanctioned_lists: [],
    first_seen: '2024-01-01T00:00:00Z',
    last_seen: '2026-04-01T00:00:00Z',
    resolution_confidence: 0.9,
    resolved_by: 'rule',
    metadata,
  };
}

function relatedEntity(id: string, jurisdiction: string): Schemas.EntityCanonical {
  return {
    ...canon({ relation_kind: 'ubo' }),
    id,
    display_name: `UBO ${id}`,
    jurisdiction,
  };
}

runPatternFixtures(pnDepth, [
  {
    name: 'related: 4 distinct jurisdictions in UBO chain',
    kind: 'TP',
    subject: companySubject({
      related: [
        relatedEntity('00000000-0000-4000-a000-000000000n01', 'BVI'),
        relatedEntity('00000000-0000-4000-a000-000000000n02', 'CYM'),
        relatedEntity('00000000-0000-4000-a000-000000000n03', 'MUS'),
        relatedEntity('00000000-0000-4000-a000-000000000n04', 'CHE'),
      ],
    }),
    expect: { matched: true },
  },
  {
    name: 'related: 2 jurisdictions only',
    kind: 'TN',
    subject: companySubject({
      related: [
        relatedEntity('00000000-0000-4000-a000-000000000n05', 'CMR'),
        relatedEntity('00000000-0000-4000-a000-000000000n06', 'FRA'),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback: count=5',
    kind: 'TP',
    subject: companySubject({ canonical: canon({ ubo_chain_jurisdiction_count: 5 }) }),
    expect: { matched: true },
  },
  {
    name: 'metadata fallback: count=3',
    kind: 'TN',
    subject: companySubject({ canonical: canon({ ubo_chain_jurisdiction_count: 3 }) }),
    expect: { matched: false },
  },
  {
    name: 'empty',
    kind: 'edge',
    subject: companySubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);

runPatternFixtures(pnUbo, [
  {
    name: 'event-based: UBO change 30 days pre-award',
    kind: 'TP',
    subject: companySubject({
      events: [
        evt(
          'company_filing',
          { change_kind: 'ubo_change' },
          { publishedAt: '2026-04-01T00:00:00Z' },
        ),
        evt('award', { supplier_name: 'X' }, { publishedAt: '2026-05-01T00:00:00Z' }),
      ],
    }),
    expect: { matched: true },
  },
  {
    name: 'event-based: UBO change 200 days pre-award (too old)',
    kind: 'TN',
    subject: companySubject({
      events: [
        evt('company_filing', { change_kind: 'unrelated' }),
        evt('award', { supplier_name: 'X' }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback: 30 days',
    kind: 'TP',
    subject: companySubject({ canonical: canon({ days_ubo_change_to_award: 30 }) }),
    expect: { matched: true },
  },
  {
    name: 'metadata fallback: 200 days',
    kind: 'TN',
    subject: companySubject({ canonical: canon({ days_ubo_change_to_award: 200 }) }),
    expect: { matched: false },
  },
  {
    name: 'no signal',
    kind: 'edge',
    subject: companySubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);

runPatternFixtures(pnHaven, [
  {
    name: 'event: haven + no substance',
    kind: 'TP',
    subject: companySubject({
      events: [
        evt('audit_observation', {
          ubo_link_in_haven_list: true,
          ubo_link_no_economic_substance: true,
        }),
      ],
    }),
    expect: { matched: true, minStrength: 0.8 },
  },
  {
    name: 'event: haven, with substance',
    kind: 'TN',
    subject: companySubject({
      events: [
        evt('audit_observation', {
          ubo_link_in_haven_list: true,
          ubo_link_no_economic_substance: false,
        }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback',
    kind: 'TP',
    subject: companySubject({
      canonical: canon({
        ubo_link_in_haven_list: true,
        ubo_link_no_economic_substance: true,
      }),
    }),
    expect: { matched: true },
  },
  {
    name: 'no haven',
    kind: 'TN',
    subject: companySubject({
      canonical: canon({ ubo_link_in_haven_list: false, ubo_link_no_economic_substance: true }),
    }),
    expect: { matched: false },
  },
  {
    name: 'empty',
    kind: 'edge',
    subject: companySubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);

runPatternFixtures(pnControl, [
  {
    name: 'event: 3 of 4 markers',
    kind: 'TP',
    subject: companySubject({
      events: [
        evt('company_filing', {
          no_ubo_declared: true,
          dual_class_shares: true,
          voting_trust_present: true,
          director_alignment_ratio: 0.4,
        }),
      ],
    }),
    expect: { matched: true, minStrength: 0.8 },
  },
  {
    name: 'event: only 1 marker',
    kind: 'TN',
    subject: companySubject({
      events: [
        evt('company_filing', {
          no_ubo_declared: true,
          dual_class_shares: false,
          voting_trust_present: false,
          director_alignment_ratio: 0.4,
        }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback: 4 markers',
    kind: 'TP',
    subject: companySubject({
      canonical: canon({
        no_ubo_declared: true,
        dual_class_shares: true,
        voting_trust_present: true,
        director_alignment_ratio: 0.8,
      }),
    }),
    expect: { matched: true },
  },
  {
    name: 'metadata fallback: 0 markers',
    kind: 'TN',
    subject: companySubject({
      canonical: canon({
        no_ubo_declared: false,
        dual_class_shares: false,
        voting_trust_present: false,
        director_alignment_ratio: 0.2,
      }),
    }),
    expect: { matched: false },
  },
  {
    name: 'empty',
    kind: 'edge',
    subject: companySubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);
