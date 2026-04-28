import pattern from '../../src/category-e/p-e-004-transaction-pep-sanctioned.js';

import { companySubject, runPatternFixtures, type PatternFixture } from '../_harness.js';

const baseCompany = {
  id: '00000000-0000-4000-a000-000000000501',
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
};
const pepCompany = { ...baseCompany, is_pep: true };
const pepPerson = {
  ...baseCompany,
  id: '00000000-0000-4000-a000-000000000502',
  kind: 'person' as const,
  display_name: 'M. PEP Director',
  is_pep: true,
};
const sanctionedRelated = {
  ...baseCompany,
  id: '00000000-0000-4000-a000-000000000503',
  display_name: 'Sanctioned Sister',
  is_sanctioned: true,
  sanctioned_lists: ['OFAC-SDN'],
};
const cleanPerson = { ...pepPerson, id: '00000000-0000-4000-a000-000000000504', is_pep: false };

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'PEP-controlled bidder + sanctioned related party',
    kind: 'TP',
    subject: companySubject({ canonical: pepCompany, related: [sanctionedRelated] }),
    expect: { matched: true, minStrength: 0.85, mustMentionInRationale: 'pep' },
  },
  {
    name: 'PEP director (not the company itself) + sanctioned related',
    kind: 'TP',
    subject: companySubject({ canonical: baseCompany, related: [pepPerson, sanctionedRelated] }),
    expect: { matched: true, minStrength: 0.85 },
  },
  {
    name: 'PEP-controlled but no sanctioned related party',
    kind: 'TN',
    subject: companySubject({ canonical: pepCompany, related: [cleanPerson] }),
    expect: { matched: false },
  },
  {
    name: 'sanctioned related but no PEP',
    kind: 'TN',
    subject: companySubject({ canonical: baseCompany, related: [sanctionedRelated] }),
    expect: { matched: false },
  },
  {
    name: 'no canonical resolved',
    kind: 'edge',
    subject: companySubject({ canonical: null, related: [pepPerson, sanctionedRelated] }),
    expect: { matched: false },
  },
  {
    name: 'multiple PEPs + multiple sanctioned related parties (combined)',
    kind: 'multi',
    subject: companySubject({
      canonical: pepCompany,
      related: [pepPerson, sanctionedRelated, sanctionedRelated],
    }),
    expect: { matched: true, minStrength: 0.85 },
  },
];

runPatternFixtures(pattern, fixtures);
