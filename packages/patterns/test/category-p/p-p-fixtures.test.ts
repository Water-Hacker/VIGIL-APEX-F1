import ppFlip from '../../src/category-p/p-p-001-property-flip-official.js';
import ppFamily from '../../src/category-p/p-p-002-family-land-transfer.js';
import ppConc from '../../src/category-p/p-p-003-real-estate-concurrent.js';
import { evt, personSubject, runPatternFixtures, type PatternFixture } from '../_harness.js';

import type { Schemas } from '@vigil/shared';

function personCanonical(
  isOfficial: boolean,
  metadata: Record<string, unknown> = {},
): Schemas.EntityCanonical {
  return {
    id: '00000000-0000-4000-a000-c00000000006',
    kind: 'Person',
    display_name: 'P-Test Person',
    rccm_number: null,
    niu: null,
    jurisdiction: 'CMR',
    region: 'CE',
    eth_address: null,
    is_pep: isOfficial,
    is_sanctioned: false,
    sanctioned_lists: [],
    first_seen: '2024-01-01T00:00:00Z',
    last_seen: '2026-04-01T00:00:00Z',
    resolution_confidence: 0.9,
    resolved_by: 'rule',
    metadata,
  };
}

runPatternFixtures(ppFlip, [
  {
    name: 'official + below market + recent',
    kind: 'TP',
    subject: personSubject({
      canonical: personCanonical(true),
      events: [
        evt('audit_observation', {
          acquisition_price_to_market_ratio: 0.4,
          days_post_award_of_decision: 90,
        }),
      ],
    }),
    expect: { matched: true, minStrength: 0.7 },
  },
  {
    name: 'official + market price',
    kind: 'TN',
    subject: personSubject({
      canonical: personCanonical(true),
      events: [
        evt('audit_observation', {
          acquisition_price_to_market_ratio: 0.95,
          days_post_award_of_decision: 30,
        }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback',
    kind: 'TP',
    subject: personSubject({
      canonical: personCanonical(false, {
        is_official: true,
        acquisition_price_to_market_ratio: 0.5,
        days_post_award_of_decision: 60,
      }),
    }),
    expect: { matched: true },
  },
  {
    name: 'not official',
    kind: 'TN',
    subject: personSubject({
      canonical: personCanonical(false, {
        acquisition_price_to_market_ratio: 0.4,
        days_post_award_of_decision: 30,
      }),
    }),
    expect: { matched: false },
  },
  {
    name: 'empty',
    kind: 'edge',
    subject: personSubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);

runPatternFixtures(ppFamily, [
  {
    name: '1st-degree family + 60 days',
    kind: 'TP',
    subject: personSubject({
      events: [
        evt('gazette_decree', {
          linked_to_official: true,
          relation_degree: 1,
          days_after_award: 60,
        }),
      ],
    }),
    expect: { matched: true, minStrength: 0.7 },
  },
  {
    name: '2nd-degree family',
    kind: 'TN',
    subject: personSubject({
      events: [
        evt('gazette_decree', {
          linked_to_official: true,
          relation_degree: 2,
          days_after_award: 60,
        }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback',
    kind: 'TP',
    subject: personSubject({
      canonical: {
        ...personCanonical(false, {
          linked_to_official: true,
          relation_degree: 1,
          days_after_award: 30,
        }),
      },
    }),
    expect: { matched: true },
  },
  {
    name: '200 days post-award (too late)',
    kind: 'TN',
    subject: personSubject({
      events: [
        evt('gazette_decree', {
          linked_to_official: true,
          relation_degree: 1,
          days_after_award: 200,
        }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'empty',
    kind: 'edge',
    subject: personSubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);

runPatternFixtures(ppConc, [
  {
    name: 'event: 60 days, 100M XAF property',
    kind: 'TP',
    subject: personSubject({
      events: [
        evt('gazette_decree', {
          days_after_state_payment: 60,
          property_value_xaf: 100_000_000,
        }),
      ],
    }),
    expect: { matched: true },
  },
  {
    name: 'event: 200 days (too late)',
    kind: 'TN',
    subject: personSubject({
      events: [
        evt('gazette_decree', {
          days_after_state_payment: 200,
          property_value_xaf: 200_000_000,
        }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback',
    kind: 'TP',
    subject: personSubject({
      canonical: personCanonical(false, {
        days_after_state_payment: 30,
        property_value_xaf: 250_000_000,
      }),
    }),
    expect: { matched: true },
  },
  {
    name: 'small property',
    kind: 'TN',
    subject: personSubject({
      events: [
        evt('gazette_decree', {
          days_after_state_payment: 30,
          property_value_xaf: 10_000_000,
        }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'empty',
    kind: 'edge',
    subject: personSubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);
