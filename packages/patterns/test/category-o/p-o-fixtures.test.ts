import poEia from '../../src/category-o/p-o-001-concession-no-eia.js';
import poPep from '../../src/category-o/p-o-002-oil-block-pep.js';
import poPsc from '../../src/category-o/p-o-003-favourable-psc-rate.js';
import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

import type { Schemas } from '@vigil/shared';

function canon(metadata: Record<string, unknown>, isPep = false): Schemas.EntityCanonical {
  return {
    id: '00000000-0000-4000-a000-c00000000005',
    kind: 'Company',
    display_name: 'O-Test',
    rccm_number: null,
    niu: null,
    jurisdiction: 'CMR',
    region: 'CE',
    eth_address: null,
    is_pep: isPep,
    is_sanctioned: false,
    sanctioned_lists: [],
    first_seen: '2024-01-01T00:00:00Z',
    last_seen: '2026-04-01T00:00:00Z',
    resolution_confidence: 0.9,
    resolved_by: 'rule',
    metadata,
  };
}

runPatternFixtures(poEia, [
  {
    name: 'event: mining sector + no EIA',
    kind: 'TP',
    subject: tenderSubject({
      events: [evt('tender_notice', { sector: 'mining', eia_present: false })],
    }),
    expect: { matched: true, minStrength: 0.7 },
  },
  {
    name: 'event: mining + EIA present',
    kind: 'TN',
    subject: tenderSubject({
      events: [evt('tender_notice', { sector: 'mining', eia_present: true })],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback',
    kind: 'TP',
    subject: tenderSubject({ canonical: canon({ sector: 'mining', eia_present: false }) }),
    expect: { matched: true },
  },
  {
    name: 'not mining',
    kind: 'TN',
    subject: tenderSubject({
      events: [evt('tender_notice', { sector: 'construction', eia_present: false })],
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

runPatternFixtures(poPep, [
  {
    name: 'event: oil + PEP + 50% benchmark',
    kind: 'TP',
    subject: tenderSubject({
      canonical: canon({}, true),
      events: [
        evt('tender_notice', {
          sector: 'oil_gas',
          transfer_price_to_benchmark: 0.5,
        }),
      ],
    }),
    expect: { matched: true, minStrength: 0.6 },
  },
  {
    name: 'event: oil + PEP + market price',
    kind: 'TN',
    subject: tenderSubject({
      canonical: canon({}, true),
      events: [
        evt('tender_notice', {
          sector: 'oil_gas',
          transfer_price_to_benchmark: 0.95,
        }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback',
    kind: 'TP',
    subject: tenderSubject({
      canonical: canon({ sector: 'oil_gas', ubo_is_pep: true, transfer_price_to_benchmark: 0.4 }),
    }),
    expect: { matched: true },
  },
  {
    name: 'no PEP',
    kind: 'TN',
    subject: tenderSubject({
      canonical: canon({ sector: 'oil_gas', ubo_is_pep: false, transfer_price_to_benchmark: 0.4 }),
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

runPatternFixtures(poPsc, [
  {
    name: 'event: high cost recovery cap',
    kind: 'TP',
    subject: tenderSubject({
      events: [evt('gazette_decree', { cost_recovery_cap: 0.9 })],
    }),
    expect: { matched: true },
  },
  {
    name: 'event: low royalty',
    kind: 'TP',
    subject: tenderSubject({
      events: [evt('gazette_decree', { royalty_rate: 0.03 })],
    }),
    expect: { matched: true },
  },
  {
    name: 'event: both anomalies',
    kind: 'TP',
    subject: tenderSubject({
      events: [evt('gazette_decree', { cost_recovery_cap: 0.9, royalty_rate: 0.02 })],
    }),
    expect: { matched: true, minStrength: 0.8 },
  },
  {
    name: 'event: within norm',
    kind: 'TN',
    subject: tenderSubject({
      events: [evt('gazette_decree', { cost_recovery_cap: 0.6, royalty_rate: 0.12 })],
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
