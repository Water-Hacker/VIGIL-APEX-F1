import pmRot from '../../src/category-m/p-m-001-bid-rotation.js';
import pmSupp from '../../src/category-m/p-m-002-bid-suppression.js';
import pmComp from '../../src/category-m/p-m-003-complementary-bidding.js';
import pmAlloc from '../../src/category-m/p-m-004-market-allocation.js';
import {
  companySubject,
  evt,
  runPatternFixtures,
  tenderSubject,
  type PatternFixture,
} from '../_harness.js';

import type { Schemas } from '@vigil/shared';

function canon(metadata: Record<string, unknown>): Schemas.EntityCanonical {
  return {
    id: '00000000-0000-4000-a000-c00000000003',
    kind: 'Company',
    display_name: 'M-Test',
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

runPatternFixtures(pmRot, [
  {
    name: 'event-based: rotation 0.85',
    kind: 'TP',
    subject: tenderSubject({
      events: [evt('audit_observation', { bid_rotation_score: 0.85 })],
    }),
    expect: { matched: true, minStrength: 0.7 },
  },
  {
    name: 'event-based: rotation 0.4',
    kind: 'TN',
    subject: tenderSubject({
      events: [evt('audit_observation', { bid_rotation_score: 0.4 })],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback: 0.75',
    kind: 'TP',
    subject: tenderSubject({ canonical: canon({ bid_rotation_score: 0.75 }) }),
    expect: { matched: true },
  },
  {
    name: 'no signal',
    kind: 'TN',
    subject: tenderSubject({}),
    expect: { matched: false },
  },
  {
    name: 'edge: exactly threshold',
    kind: 'edge',
    subject: tenderSubject({ canonical: canon({ bid_rotation_score: 0.6 }) }),
    expect: { matched: true, minStrength: 0.55 },
  },
] satisfies ReadonlyArray<PatternFixture>);

runPatternFixtures(pmSupp, [
  {
    name: 'event-based: 70% withdrawal + same winner',
    kind: 'TP',
    subject: tenderSubject({
      events: [
        evt('audit_observation', {
          bid_withdrawal_rate: 0.7,
          same_winner_post_withdrawals: true,
        }),
      ],
    }),
    expect: { matched: true, minStrength: 0.6 },
  },
  {
    name: 'event-based: high withdrawal but different winner',
    kind: 'TN',
    subject: tenderSubject({
      events: [
        evt('audit_observation', {
          bid_withdrawal_rate: 0.8,
          same_winner_post_withdrawals: false,
        }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback',
    kind: 'TP',
    subject: tenderSubject({
      canonical: canon({
        bid_withdrawal_rate: 0.6,
        same_winner_post_withdrawals: true,
      }),
    }),
    expect: { matched: true },
  },
  {
    name: 'low withdrawal',
    kind: 'TN',
    subject: tenderSubject({
      canonical: canon({ bid_withdrawal_rate: 0.2, same_winner_post_withdrawals: true }),
    }),
    expect: { matched: false },
  },
  {
    name: 'empty',
    kind: 'edge',
    subject: tenderSubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);

runPatternFixtures(pmComp, [
  {
    name: 'event-based: high evenness',
    kind: 'TP',
    subject: tenderSubject({
      events: [evt('audit_observation', { bid_spread_evenness_score: 0.9 })],
    }),
    expect: { matched: true },
  },
  {
    name: 'event-based: high defect rate',
    kind: 'TP',
    subject: tenderSubject({
      events: [evt('audit_observation', { losing_bid_defect_rate: 0.8 })],
    }),
    expect: { matched: true },
  },
  {
    name: 'event-based: both low',
    kind: 'TN',
    subject: tenderSubject({
      events: [
        evt('audit_observation', {
          bid_spread_evenness_score: 0.3,
          losing_bid_defect_rate: 0.2,
        }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback',
    kind: 'TP',
    subject: tenderSubject({
      canonical: canon({ bid_spread_evenness_score: 0.85, losing_bid_defect_rate: 0.6 }),
    }),
    expect: { matched: true },
  },
  {
    name: 'empty',
    kind: 'edge',
    subject: tenderSubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);

runPatternFixtures(pmAlloc, [
  {
    name: 'event-based: high HHI + coverage',
    kind: 'TP',
    subject: companySubject({
      events: [
        evt('audit_observation', {
          bidder_geographic_hhi: 0.9,
          cartel_market_coverage: 0.85,
        }),
      ],
    }),
    expect: { matched: true, minStrength: 0.7 },
  },
  {
    name: 'event-based: HHI high but coverage low',
    kind: 'TN',
    subject: companySubject({
      events: [
        evt('audit_observation', {
          bidder_geographic_hhi: 0.9,
          cartel_market_coverage: 0.5,
        }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback',
    kind: 'TP',
    subject: companySubject({
      canonical: canon({ bidder_geographic_hhi: 0.88, cartel_market_coverage: 0.82 }),
    }),
    expect: { matched: true },
  },
  {
    name: 'no signal',
    kind: 'TN',
    subject: companySubject({}),
    expect: { matched: false },
  },
  {
    name: 'edge',
    kind: 'edge',
    subject: companySubject({
      canonical: canon({ bidder_geographic_hhi: 0.6, cartel_market_coverage: 0.6 }),
    }),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);
