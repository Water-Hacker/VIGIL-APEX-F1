import pkOver from '../../src/category-k/p-k-001-over-invoicing.js';
import pkUnder from '../../src/category-k/p-k-002-under-invoicing.js';
import pkMulti from '../../src/category-k/p-k-003-multiple-invoicing.js';
import pkPhantom from '../../src/category-k/p-k-004-phantom-shipment.js';
import pkMisclass from '../../src/category-k/p-k-005-misclassification.js';
import pkRound from '../../src/category-k/p-k-006-round-trip-trade.js';
import {
  evt,
  paymentSubject,
  companySubject,
  runPatternFixtures,
  type PatternFixture,
} from '../_harness.js';

import type { Schemas } from '@vigil/shared';

function canonicalWith(metadata: Record<string, unknown>): Schemas.EntityCanonical {
  return {
    id: '00000000-0000-4000-a000-c00000000002',
    kind: 'Company',
    display_name: 'TBML Test Subject',
    rccm_number: null,
    niu: null,
    jurisdiction: 'CMR',
    region: 'LT',
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

runPatternFixtures(pkOver, [
  {
    name: 'event payload: ratio 2.5',
    kind: 'TP',
    subject: paymentSubject({
      events: [evt('payment_order', { unit_price_to_world_reference_ratio: 2.5 })],
    }),
    expect: { matched: true, minStrength: 0.5 },
  },
  {
    name: 'event payload: ratio 1.2 (below)',
    kind: 'TN',
    subject: paymentSubject({
      events: [evt('payment_order', { unit_price_to_world_reference_ratio: 1.2 })],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback: ratio 1.8',
    kind: 'TP',
    subject: paymentSubject({
      canonical: canonicalWith({ unit_price_to_world_reference_ratio: 1.8 }),
    }),
    expect: { matched: true },
  },
  {
    name: 'metadata fallback: ratio 1.0 (no anomaly)',
    kind: 'TN',
    subject: paymentSubject({
      canonical: canonicalWith({ unit_price_to_world_reference_ratio: 1.0 }),
    }),
    expect: { matched: false },
  },
  {
    name: 'no signal',
    kind: 'edge',
    subject: paymentSubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);

runPatternFixtures(pkUnder, [
  {
    name: 'event payload: ratio 0.3 (severe under)',
    kind: 'TP',
    subject: paymentSubject({
      events: [evt('payment_order', { unit_price_to_world_reference_ratio: 0.3 })],
    }),
    expect: { matched: true, minStrength: 0.6 },
  },
  {
    name: 'metadata fallback: ratio 0.4',
    kind: 'TP',
    subject: paymentSubject({
      canonical: canonicalWith({ unit_price_to_world_reference_ratio: 0.4 }),
    }),
    expect: { matched: true },
  },
  {
    name: 'ratio 0.9 (within range)',
    kind: 'TN',
    subject: paymentSubject({
      canonical: canonicalWith({ unit_price_to_world_reference_ratio: 0.9 }),
    }),
    expect: { matched: false },
  },
  {
    name: 'no signal — default is no signal, not 1.0',
    kind: 'edge',
    subject: paymentSubject({}),
    expect: { matched: false },
  },
  {
    name: 'TN — empty events list',
    kind: 'TN',
    subject: paymentSubject({ events: [] }),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);

runPatternFixtures(pkMulti, [
  {
    name: 'event-based: 3 invoices share BoL',
    kind: 'TP',
    subject: paymentSubject({
      events: [
        evt('payment_order', { bill_of_lading: 'BOL-123', amount_xaf: 100_000_000 }),
        evt('payment_order', { bill_of_lading: 'BOL-123', amount_xaf: 100_000_000 }),
        evt('payment_order', { bill_of_lading: 'BOL-123', amount_xaf: 100_000_000 }),
      ],
    }),
    expect: { matched: true, minStrength: 0.7 },
  },
  {
    name: 'event-based: distinct BoLs',
    kind: 'TN',
    subject: paymentSubject({
      events: [
        evt('payment_order', { bill_of_lading: 'BOL-A' }),
        evt('payment_order', { bill_of_lading: 'BOL-B' }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback: duplicate_invoice_count=3',
    kind: 'TP',
    subject: paymentSubject({
      canonical: canonicalWith({ duplicate_invoice_count: 3 }),
    }),
    expect: { matched: true },
  },
  {
    name: 'metadata fallback: zero duplicates',
    kind: 'TN',
    subject: paymentSubject({
      canonical: canonicalWith({ duplicate_invoice_count: 1 }),
    }),
    expect: { matched: false },
  },
  {
    name: 'empty subject',
    kind: 'edge',
    subject: paymentSubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);

runPatternFixtures(pkPhantom, [
  {
    name: 'event-based: both flags set',
    kind: 'TP',
    subject: paymentSubject({
      events: [evt('payment_order', { no_customs_declaration: true, no_bill_of_lading: true })],
    }),
    expect: { matched: true, minStrength: 0.9 },
  },
  {
    name: 'event-based: customs missing only',
    kind: 'TP',
    subject: paymentSubject({
      events: [evt('payment_order', { no_customs_declaration: true })],
    }),
    expect: { matched: true, minStrength: 0.5 },
  },
  {
    name: 'metadata fallback: both flags',
    kind: 'TP',
    subject: paymentSubject({
      canonical: canonicalWith({ no_customs_declaration: true, no_bill_of_lading: true }),
    }),
    expect: { matched: true },
  },
  {
    name: 'all evidence present',
    kind: 'TN',
    subject: paymentSubject({
      events: [evt('payment_order', { no_customs_declaration: false, no_bill_of_lading: false })],
    }),
    expect: { matched: false },
  },
  {
    name: 'empty subject',
    kind: 'edge',
    subject: paymentSubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);

runPatternFixtures(pkMisclass, [
  {
    name: 'event-based: HS mismatch + sanctions',
    kind: 'TP',
    subject: paymentSubject({
      events: [
        evt('audit_observation', {
          hs_code_mismatch: true,
          hs_mismatch_implicates_sanction: true,
        }),
      ],
    }),
    expect: { matched: true, minStrength: 0.8 },
  },
  {
    name: 'event-based: HS mismatch, no sanctions',
    kind: 'TP',
    subject: paymentSubject({
      events: [evt('audit_observation', { hs_code_mismatch: true })],
    }),
    expect: { matched: true, minStrength: 0.5 },
  },
  {
    name: 'metadata fallback: mismatch only',
    kind: 'TP',
    subject: paymentSubject({
      canonical: canonicalWith({ hs_code_mismatch: true }),
    }),
    expect: { matched: true },
  },
  {
    name: 'HS codes match',
    kind: 'TN',
    subject: paymentSubject({
      canonical: canonicalWith({ hs_code_mismatch: false }),
    }),
    expect: { matched: false },
  },
  {
    name: 'empty subject',
    kind: 'edge',
    subject: paymentSubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);

runPatternFixtures(pkRound, [
  {
    name: 'event-based: round-trip + offshore',
    kind: 'TP',
    subject: companySubject({
      events: [
        evt('company_filing', {
          round_trip_detected: true,
          round_trip_via_offshore: true,
        }),
      ],
    }),
    expect: { matched: true, minStrength: 0.8 },
  },
  {
    name: 'event-based: round-trip without offshore',
    kind: 'TP',
    subject: companySubject({
      events: [evt('company_filing', { round_trip_detected: true })],
    }),
    expect: { matched: true, minStrength: 0.5 },
  },
  {
    name: 'metadata fallback',
    kind: 'TP',
    subject: companySubject({
      canonical: canonicalWith({ round_trip_detected: true, round_trip_via_offshore: true }),
    }),
    expect: { matched: true },
  },
  {
    name: 'no round-trip',
    kind: 'TN',
    subject: companySubject({
      canonical: canonicalWith({ round_trip_detected: false }),
    }),
    expect: { matched: false },
  },
  {
    name: 'empty subject',
    kind: 'edge',
    subject: companySubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);
