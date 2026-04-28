import pattern from '../../src/category-f/p-f-003-supplier-circular-flow.js';

import { companySubject, runPatternFixtures, type PatternFixture } from '../_harness.js';

const baseCompany = {
  id: '00000000-0000-4000-a000-000000000c01',
  kind: 'company' as const,
  display_name: 'Bidder Co.',
  rccm_number: null,
  niu: null,
  jurisdiction: 'Cameroun',
  region: 'CE' as const,
  eth_address: null,
  is_pep: false,
  is_sanctioned: false,
  sanctioned_lists: [] as string[],
  first_seen: '2022-01-01T00:00:00Z',
  last_seen: '2026-01-01T00:00:00Z',
  resolution_confidence: 0.95,
  resolved_by: 'rule' as const,
  metadata: {},
};
const cycle3 = { ...baseCompany, metadata: { supplierCycleLength: 3 } };
const cycle5 = { ...baseCompany, metadata: { supplierCycleLength: 5 } };
const cycle10 = { ...baseCompany, metadata: { supplierCycleLength: 10 } };
const cycle2 = { ...baseCompany, metadata: { supplierCycleLength: 2 } };
const cycle0 = { ...baseCompany, metadata: { supplierCycleLength: 0 } };

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: '3-node cycle (A→B→C→A) — strongest signal',
    kind: 'TP',
    subject: companySubject({ canonical: cycle3 }),
    expect: { matched: true, minStrength: 0.85, mustMentionInRationale: '3-node' },
  },
  {
    name: '5-node cycle — moderate strength',
    kind: 'TP',
    subject: companySubject({ canonical: cycle5 }),
    expect: { matched: true, minStrength: 0.5 },
  },
  {
    name: '10-node cycle — floored at 0.5',
    kind: 'edge',
    subject: companySubject({ canonical: cycle10 }),
    expect: { matched: true, minStrength: 0.5, maxStrength: 0.55 },
  },
  {
    name: 'cycle length 2 — under 3-node threshold',
    kind: 'TN',
    subject: companySubject({ canonical: cycle2 }),
    expect: { matched: false, mustMentionInRationale: 'cycle=2' },
  },
  {
    name: 'cycle length 0 (no cycle detected)',
    kind: 'TN',
    subject: companySubject({ canonical: cycle0 }),
    expect: { matched: false },
  },
  {
    name: 'metadata bag empty — defaults to 0 → no match',
    kind: 'TN',
    subject: companySubject({ canonical: baseCompany }),
    expect: { matched: false },
  },
];

runPatternFixtures(pattern, fixtures);
