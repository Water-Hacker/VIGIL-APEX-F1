import pattern from '../../src/category-e/p-e-002-sanctioned-related.js';

import { companySubject, runPatternFixtures, type PatternFixture } from '../_harness.js';

const baseCompany = {
  id: '00000000-0000-4000-a000-000000000401',
  kind: 'company' as const,
  display_name: 'Bidder Co.',
  rccm_number: 'CM-DLA-2022-B-12345',
  niu: 'M9876543210',
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
const sanctionedSubsidiary = {
  ...baseCompany,
  id: '00000000-0000-4000-a000-000000000402',
  display_name: 'Sanctioned Subsidiary',
  is_sanctioned: true,
  sanctioned_lists: ['OFAC-SDN'],
};
const cleanRelated = {
  ...baseCompany,
  id: '00000000-0000-4000-a000-000000000403',
  display_name: 'Clean Sister Co.',
};
const directlySanctioned = { ...baseCompany, is_sanctioned: true, sanctioned_lists: ['OFAC-SDN'] };

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'one related sanctioned subsidiary',
    kind: 'TP',
    subject: companySubject({ canonical: baseCompany, related: [sanctionedSubsidiary] }),
    expect: { matched: true, minStrength: 0.5, mustMentionInRationale: 'sanctioned' },
  },
  {
    name: 'three sanctioned related parties — strength rises but caps at 0.85',
    kind: 'TP',
    subject: companySubject({
      canonical: baseCompany,
      related: [
        sanctionedSubsidiary,
        { ...sanctionedSubsidiary, id: '00000000-0000-4000-a000-000000000404' },
        { ...sanctionedSubsidiary, id: '00000000-0000-4000-a000-000000000405' },
      ],
    }),
    expect: { matched: true, minStrength: 0.7, maxStrength: 0.85 },
  },
  {
    name: 'related parties present but none sanctioned',
    kind: 'TN',
    subject: companySubject({ canonical: baseCompany, related: [cleanRelated] }),
    expect: { matched: false },
  },
  {
    name: 'subject is itself sanctioned — defers to P-E-001',
    kind: 'TN',
    subject: companySubject({ canonical: directlySanctioned, related: [sanctionedSubsidiary] }),
    expect: { matched: false, mustMentionInRationale: 'p-e-001' },
  },
  {
    name: 'no canonical resolved (anonymous bidder)',
    kind: 'edge',
    subject: companySubject({ canonical: null, related: [sanctionedSubsidiary] }),
    expect: { matched: false },
  },
  {
    name: 'mix of clean + one sanctioned (multi-related)',
    kind: 'multi',
    subject: companySubject({
      canonical: baseCompany,
      related: [cleanRelated, sanctionedSubsidiary, cleanRelated],
    }),
    expect: { matched: true, minStrength: 0.5 },
  },
];

runPatternFixtures(pattern, fixtures);
