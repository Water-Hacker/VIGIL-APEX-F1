/**
 * Detailed reference fixtures for P-E-001 (sanctioned-list direct hit).
 * The strongest signal in the platform — single positive moves a finding
 * past the council-review threshold by itself.
 */
import pattern from '../../src/category-e/p-e-001-sanctioned-direct.js';

import { companySubject, runPatternFixtures, type PatternFixture } from '../_harness.js';

const sanctioned = {
  id: '00000000-0000-4000-a000-000000000301',
  kind: 'company' as const,
  display_name: 'Test Sanctioned Co.',
  rccm_number: 'CM-DLA-2020-B-00001',
  niu: 'M1234567890',
  jurisdiction: 'Cameroun',
  region: 'CE' as const,
  eth_address: null,
  is_pep: false,
  is_sanctioned: true,
  sanctioned_lists: ['OFAC-SDN'] as string[],
  first_seen: '2020-01-01T00:00:00Z',
  last_seen: '2026-01-01T00:00:00Z',
  resolution_confidence: 0.99,
  resolved_by: 'rule' as const,
  metadata: {},
};
const clean = { ...sanctioned, id: '00000000-0000-4000-a000-000000000302', is_sanctioned: false, sanctioned_lists: [] as string[] };

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'subject is OFAC SDN-listed',
    kind: 'TP',
    subject: companySubject({ canonical: sanctioned }),
    expect: { matched: true, minStrength: 0.9, mustMentionInRationale: 'ofac' },
  },
  {
    name: 'multi-list listing further raises confidence',
    kind: 'TP',
    subject: companySubject({
      canonical: { ...sanctioned, sanctioned_lists: ['OFAC-SDN', 'EU-SAN', 'UN-1267'] },
    }),
    expect: { matched: true, minStrength: 0.95 },
  },
  {
    name: 'subject is clean — no list match',
    kind: 'TN',
    subject: companySubject({ canonical: clean }),
    expect: { matched: false },
  },
  {
    name: 'no canonical resolved',
    kind: 'TN',
    subject: companySubject({ canonical: null }),
    expect: { matched: false },
  },
  {
    name: 'is_sanctioned=true but sanctioned_lists empty (data anomaly)',
    kind: 'edge',
    subject: companySubject({ canonical: { ...sanctioned, sanctioned_lists: [] } }),
    expect: { matched: true, minStrength: 0.5 },
  },
];

runPatternFixtures(pattern, fixtures);
