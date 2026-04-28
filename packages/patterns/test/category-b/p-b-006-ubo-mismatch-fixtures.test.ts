import pattern from '../../src/category-b/p-b-006-ubo-mismatch.js';

import { companySubject, runPatternFixtures, type PatternFixture } from '../_harness.js';

const baseCompany = {
  id: '00000000-0000-4000-a000-00000000ff01',
  kind: 'company' as const,
  display_name: 'Bidder Co.',
  rccm_number: 'CM-DLA-2022-B-66660',
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
const mismatched = {
  ...baseCompany,
  metadata: {
    declared_ubo: 'M. Alpha Bravo',
    registry_ubo: 'M. Charlie Delta',
  },
};
const matchingCase = {
  ...baseCompany,
  metadata: {
    declared_ubo: 'M. Alpha Bravo',
    registry_ubo: 'M. Alpha Bravo',
  },
};
const matchingCaseInsensitive = {
  ...baseCompany,
  metadata: {
    declared_ubo: 'M. Alpha BRAVO',
    registry_ubo: 'm.  alpha bravo  ', // whitespace + case differences
  },
};
const onlyDeclared = { ...baseCompany, metadata: { declared_ubo: 'M. Alpha Bravo' } };
const onlyRegistry = { ...baseCompany, metadata: { registry_ubo: 'M. Alpha Bravo' } };

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'declared UBO ≠ registry UBO',
    kind: 'TP',
    subject: companySubject({ canonical: mismatched }),
    expect: { matched: true, minStrength: 0.65, mustMentionInRationale: 'alpha bravo' },
  },
  {
    name: 'UBOs match exactly',
    kind: 'TN',
    subject: companySubject({ canonical: matchingCase }),
    expect: { matched: false, mustMentionInRationale: 'ubo match' },
  },
  {
    name: 'UBO match after case + whitespace normalisation',
    kind: 'TN',
    subject: companySubject({ canonical: matchingCaseInsensitive }),
    expect: { matched: false },
  },
  {
    name: 'only declared UBO recorded — pattern abstains',
    kind: 'TN',
    subject: companySubject({ canonical: onlyDeclared }),
    expect: { matched: false, mustMentionInRationale: 'ubo sources missing' },
  },
  {
    name: 'only registry UBO recorded',
    kind: 'TN',
    subject: companySubject({ canonical: onlyRegistry }),
    expect: { matched: false, mustMentionInRationale: 'ubo sources missing' },
  },
  {
    name: 'no canonical subject',
    kind: 'edge',
    subject: companySubject({ canonical: null }),
    expect: { matched: false, mustMentionInRationale: 'no company' },
  },
];

runPatternFixtures(pattern, fixtures);
