import pattern from '../../src/category-f/p-f-002-director-ring.js';

import { companySubject, runPatternFixtures, type PatternFixture } from '../_harness.js';

const baseCompany = {
  id: '00000000-0000-4000-a000-000000000b01',
  kind: 'company' as const,
  display_name: 'Bidder Co.',
  rccm_number: 'CM-DLA-2022-B-13131',
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
const ringDirector = {
  ...baseCompany,
  id: '00000000-0000-4000-a000-000000000b02',
  kind: 'person' as const,
  display_name: 'M. Ring Director',
  metadata: { directorRingFlag: true },
};
const cleanPerson = {
  ...baseCompany,
  id: '00000000-0000-4000-a000-000000000b03',
  kind: 'person' as const,
  display_name: 'M. Clean',
  metadata: {},
};
const ringDirector2 = { ...ringDirector, id: '00000000-0000-4000-a000-000000000b04' };
const ringDirector3 = { ...ringDirector, id: '00000000-0000-4000-a000-000000000b05' };
const ringDirector4 = { ...ringDirector, id: '00000000-0000-4000-a000-000000000b06' };

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: '2 ring-flagged directors — minimum match',
    kind: 'TP',
    subject: companySubject({ canonical: baseCompany, related: [ringDirector, ringDirector2] }),
    expect: { matched: true, minStrength: 0.6, mustMentionInRationale: 'shared' },
  },
  {
    name: '4 ring-flagged directors — strong cluster',
    kind: 'TP',
    subject: companySubject({
      canonical: baseCompany,
      related: [ringDirector, ringDirector2, ringDirector3, ringDirector4],
    }),
    expect: { matched: true, minStrength: 0.95 },
  },
  {
    name: '1 ring-flagged director — under threshold',
    kind: 'TN',
    subject: companySubject({ canonical: baseCompany, related: [ringDirector] }),
    expect: { matched: false, mustMentionInRationale: 'only 1 shared' },
  },
  {
    name: 'related include companies, not persons',
    kind: 'TN',
    subject: companySubject({ canonical: baseCompany, related: [baseCompany] }),
    expect: { matched: false },
  },
  {
    name: 'persons related but none ring-flagged',
    kind: 'TN',
    subject: companySubject({ canonical: baseCompany, related: [cleanPerson, cleanPerson] }),
    expect: { matched: false },
  },
  {
    name: 'mix — one flagged + one clean',
    kind: 'edge',
    subject: companySubject({ canonical: baseCompany, related: [ringDirector, cleanPerson] }),
    expect: { matched: false, mustMentionInRationale: 'only 1' },
  },
];

runPatternFixtures(pattern, fixtures);
