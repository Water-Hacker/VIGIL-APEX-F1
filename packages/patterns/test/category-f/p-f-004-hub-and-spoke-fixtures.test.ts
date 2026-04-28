import pattern from '../../src/category-f/p-f-004-hub-and-spoke.js';

import { companySubject, runPatternFixtures, type PatternFixture } from '../_harness.js';

const baseCompany = {
  id: '00000000-0000-4000-a000-000000000d01',
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
const heavyHub = {
  ...baseCompany,
  metadata: { authorityConcentrationRatio: 0.95, publicContractsCount: 12 },
};
const moderateHub = {
  ...baseCompany,
  metadata: { authorityConcentrationRatio: 0.78, publicContractsCount: 8 },
};
const justUnder = {
  ...baseCompany,
  metadata: { authorityConcentrationRatio: 0.69, publicContractsCount: 5 },
};
const lowVolume = {
  ...baseCompany,
  metadata: { authorityConcentrationRatio: 0.95, publicContractsCount: 2 },
};
const noConcentration = {
  ...baseCompany,
  metadata: { authorityConcentrationRatio: 0.30, publicContractsCount: 12 },
};

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: '95% concentration on one authority across 12 contracts',
    kind: 'TP',
    subject: companySubject({ canonical: heavyHub }),
    expect: { matched: true, minStrength: 0.85, mustMentionInRationale: 'hub ratio' },
  },
  {
    name: '78% concentration across 8 contracts',
    kind: 'TP',
    subject: companySubject({ canonical: moderateHub }),
    expect: { matched: true, minStrength: 0.6 },
  },
  {
    name: '69% concentration — just under 70% threshold',
    kind: 'TN',
    subject: companySubject({ canonical: justUnder }),
    expect: { matched: false, mustMentionInRationale: 'hubratio' },
  },
  {
    name: 'high concentration but only 2 contracts — too few to be a hub',
    kind: 'TN',
    subject: companySubject({ canonical: lowVolume }),
    expect: { matched: false, mustMentionInRationale: 'contracts=2' },
  },
  {
    name: 'distributed across many authorities',
    kind: 'TN',
    subject: companySubject({ canonical: noConcentration }),
    expect: { matched: false },
  },
  {
    name: 'subject is a person, not a company',
    kind: 'edge',
    subject: companySubject({
      canonical: { ...heavyHub, kind: 'person' as const },
    }),
    expect: { matched: false, mustMentionInRationale: 'no company' },
  },
];

runPatternFixtures(pattern, fixtures);
