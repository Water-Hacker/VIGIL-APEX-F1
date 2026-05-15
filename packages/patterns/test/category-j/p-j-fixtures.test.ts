import pjRev from '../../src/category-j/p-j-001-premature-revenue.js';
import pjAssets from '../../src/category-j/p-j-002-overstated-assets.js';
import pjConcealed from '../../src/category-j/p-j-003-concealed-liabilities.js';
import pjCapex from '../../src/category-j/p-j-004-expense-capitalisation.js';
import pjRelated from '../../src/category-j/p-j-005-related-party-undisclosed.js';
import { companySubject, evt, runPatternFixtures, type PatternFixture } from '../_harness.js';

import type { Schemas } from '@vigil/shared';

// Helper: minimal EntityCanonical with metadata bag for fallback testing.
function canonicalWith(metadata: Record<string, unknown>): Schemas.EntityCanonical {
  return {
    id: '00000000-0000-4000-a000-c00000000001',
    kind: 'Company',
    display_name: 'Test Company SARL',
    rccm_number: 'RC/YAO/2024/B/0001',
    niu: 'M042200012345R',
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

// P-J-001 — premature revenue
runPatternFixtures(pjRev, [
  {
    name: 'event-based: large unverified revenue gap',
    kind: 'TP',
    subject: companySubject({
      events: [
        evt('company_filing', { revenue_xaf: 1_000_000_000, verifiable_receipts_xaf: 400_000_000 }),
      ],
    }),
    expect: { matched: true, minStrength: 0.6 },
  },
  {
    name: 'event-based: revenue fully matched by receipts',
    kind: 'TN',
    subject: companySubject({
      events: [
        evt('company_filing', { revenue_xaf: 1_000_000_000, verifiable_receipts_xaf: 950_000_000 }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback: 70% gap',
    kind: 'TP',
    subject: companySubject({
      canonical: canonicalWith({
        revenue_minus_verifiable_xaf: 700_000_000,
        revenue_unverifiable_ratio: 0.7,
      }),
    }),
    expect: { matched: true, minStrength: 0.5 },
  },
  {
    name: 'metadata fallback: ratio below threshold',
    kind: 'TN',
    subject: companySubject({
      canonical: canonicalWith({
        revenue_minus_verifiable_xaf: 30_000_000,
        revenue_unverifiable_ratio: 0.1,
      }),
    }),
    expect: { matched: false },
  },
  {
    name: 'empty subject — no signals',
    kind: 'edge',
    subject: companySubject({}),
    expect: { matched: false, maxStrength: 0 },
  },
]);

// P-J-002 — overstated assets
runPatternFixtures(pjAssets, [
  {
    name: 'event-based: 40% book over independent valuation',
    kind: 'TP',
    subject: companySubject({
      events: [
        evt('company_filing', { book_value_xaf: 1_000_000_000 }),
        evt('audit_observation', { independent_valuation_xaf: 600_000_000 }),
      ],
    }),
    expect: { matched: true, minStrength: 0.6 },
  },
  {
    name: 'event-based: book matches valuation',
    kind: 'TN',
    subject: companySubject({
      events: [
        evt('company_filing', { book_value_xaf: 1_000_000_000 }),
        evt('audit_observation', { independent_valuation_xaf: 950_000_000 }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback: 50% overvaluation',
    kind: 'TP',
    subject: companySubject({
      canonical: canonicalWith({ asset_overvaluation_ratio: 0.5 }),
    }),
    expect: { matched: true },
  },
  {
    name: 'metadata fallback: below threshold',
    kind: 'TN',
    subject: companySubject({
      canonical: canonicalWith({ asset_overvaluation_ratio: 0.1 }),
    }),
    expect: { matched: false },
  },
  {
    name: 'no events, no metadata',
    kind: 'edge',
    subject: companySubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);

// P-J-003 — concealed liabilities
runPatternFixtures(pjConcealed, [
  {
    name: 'event-based: court-ordered liability 200M, declared 0',
    kind: 'TP',
    subject: companySubject({
      events: [
        evt('court_judgement', { obligation_xaf: 200_000_000 }),
        evt('company_filing', { liability_xaf: 0 }),
      ],
    }),
    expect: { matched: true, minStrength: 0.3 },
  },
  {
    name: 'event-based: declared matches discovered',
    kind: 'TN',
    subject: companySubject({
      events: [
        evt('court_judgement', { obligation_xaf: 50_000_000 }),
        evt('company_filing', { liability_xaf: 50_000_000 }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback: 500M hidden',
    kind: 'TP',
    subject: companySubject({
      canonical: canonicalWith({ hidden_liabilities_xaf: 500_000_000 }),
    }),
    expect: { matched: true },
  },
  {
    name: 'metadata fallback: below 100M threshold',
    kind: 'TN',
    subject: companySubject({
      canonical: canonicalWith({ hidden_liabilities_xaf: 50_000_000 }),
    }),
    expect: { matched: false },
  },
  {
    name: 'no signals',
    kind: 'edge',
    subject: companySubject({}),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);

// P-J-004 — expense capitalisation
runPatternFixtures(pjCapex, [
  {
    name: 'event-based: capex ratio 60% above sector median',
    kind: 'TP',
    subject: companySubject({
      events: [
        evt('company_filing', {
          capex_xaf: 800_000_000,
          opex_xaf: 1_000_000_000,
          sector_capex_opex_median: 0.5,
        }),
      ],
    }),
    expect: { matched: true, minStrength: 0.5 },
  },
  {
    name: 'event-based: capex at sector median',
    kind: 'TN',
    subject: companySubject({
      events: [
        evt('company_filing', {
          capex_xaf: 500_000_000,
          opex_xaf: 1_000_000_000,
          sector_capex_opex_median: 0.5,
        }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback: 45% deviation',
    kind: 'TP',
    subject: companySubject({
      canonical: canonicalWith({ capex_to_benchmark_deviation: 0.45 }),
    }),
    expect: { matched: true },
  },
  {
    name: 'metadata fallback: below threshold',
    kind: 'TN',
    subject: companySubject({
      canonical: canonicalWith({ capex_to_benchmark_deviation: 0.1 }),
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

// P-J-005 — undisclosed related-party transaction
const relatedCounter = '00000000-0000-4000-a000-000000aaaa01';
runPatternFixtures(pjRelated, [
  {
    name: 'event-based: payments to shared-UBO counterparty, none declared',
    kind: 'TP',
    subject: companySubject({
      related: [
        {
          ...canonicalWith({ relation_kind: 'shared_ubo' }),
          id: relatedCounter,
          display_name: 'Related Co SARL',
        },
      ],
      events: [
        evt('payment_order', {
          counterparty_id: relatedCounter,
          amount_xaf: 200_000_000,
        }),
        evt('company_filing', { related_party_disclosed_xaf: 0 }),
      ],
    }),
    expect: { matched: true },
  },
  {
    name: 'event-based: payments matched by disclosure',
    kind: 'TN',
    subject: companySubject({
      related: [
        {
          ...canonicalWith({ relation_kind: 'shared_ubo' }),
          id: relatedCounter,
          display_name: 'Related Co SARL',
        },
      ],
      events: [
        evt('payment_order', {
          counterparty_id: relatedCounter,
          amount_xaf: 200_000_000,
        }),
        evt('company_filing', { related_party_disclosed_xaf: 200_000_000 }),
      ],
    }),
    expect: { matched: false },
  },
  {
    name: 'metadata fallback: 100M undisclosed',
    kind: 'TP',
    subject: companySubject({
      canonical: canonicalWith({ related_party_undisclosed_xaf: 100_000_000 }),
    }),
    expect: { matched: true },
  },
  {
    name: 'metadata fallback: below threshold',
    kind: 'TN',
    subject: companySubject({
      canonical: canonicalWith({ related_party_undisclosed_xaf: 10_000_000 }),
    }),
    expect: { matched: false },
  },
  {
    name: 'unrelated counterparty payments — not in related set',
    kind: 'edge',
    subject: companySubject({
      events: [
        evt('payment_order', {
          counterparty_id: 'unrelated-id',
          amount_xaf: 500_000_000,
        }),
      ],
    }),
    expect: { matched: false },
  },
] satisfies ReadonlyArray<PatternFixture>);
