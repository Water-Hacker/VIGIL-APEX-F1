import pattern from '../../src/category-b/p-b-002-nominee-director.js';

import { personSubject, runPatternFixtures, type PatternFixture } from '../_harness.js';

const personDirector = {
  id: '00000000-0000-4000-a000-000000000e01',
  kind: 'person' as const,
  display_name: 'M. Nominee',
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
  resolution_confidence: 0.9,
  resolved_by: 'rule' as const,
  metadata: {},
};

function makeCompany(id: string, isAwardee: boolean) {
  return {
    ...personDirector,
    id,
    kind: 'company' as const,
    display_name: `Co ${id.slice(-3)}`,
    metadata: isAwardee ? { tags: ['public-contract-awardee'] } : {},
  };
}

// 12 companies — 3 are public-contract awardees.
const twelveCompanies = Array.from({ length: 12 }, (_, i) =>
  makeCompany(`00000000-0000-4000-a000-0000000010${String(i).padStart(2, '0')}`, i < 3),
);
// 12 companies but only 1 awardee.
const twelveOneAwardee = Array.from({ length: 12 }, (_, i) =>
  makeCompany(`00000000-0000-4000-a000-0000000011${String(i).padStart(2, '0')}`, i === 0),
);
// 5 companies — under nominee threshold.
const fiveCompanies = Array.from({ length: 5 }, (_, i) =>
  makeCompany(`00000000-0000-4000-a000-0000000012${String(i).padStart(2, '0')}`, i < 2),
);
// 20 companies, 5 awardees — heavy nominee.
const twentyHeavy = Array.from({ length: 20 }, (_, i) =>
  makeCompany(`00000000-0000-4000-a000-0000000013${String(i).padStart(2, '0')}`, i < 5),
);

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: '12 companies, 3 awardees — match',
    kind: 'TP',
    subject: personSubject({ canonical: personDirector, related: twelveCompanies }),
    expect: { matched: true, minStrength: 0.7, mustMentionInRationale: 'awardees' },
  },
  {
    name: '20 companies, 5 awardees — strong nominee signal',
    kind: 'TP',
    subject: personSubject({ canonical: personDirector, related: twentyHeavy }),
    expect: { matched: true, minStrength: 0.95 },
  },
  {
    name: '5 companies — under 10-company nominee threshold',
    kind: 'TN',
    subject: personSubject({ canonical: personDirector, related: fiveCompanies }),
    expect: { matched: false, mustMentionInRationale: 'directs only' },
  },
  {
    name: '12 companies but only 1 awardee — under awardee threshold',
    kind: 'TN',
    subject: personSubject({ canonical: personDirector, related: twelveOneAwardee }),
    expect: { matched: false, mustMentionInRationale: 'fewer than 2 awardee' },
  },
  {
    name: 'subject is not a person',
    kind: 'edge',
    subject: personSubject({
      canonical: { ...personDirector, kind: 'company' as const },
      related: twelveCompanies,
    }),
    expect: { matched: false, mustMentionInRationale: 'no person' },
  },
  {
    name: '15 companies, 4 awardees — moderate signal',
    kind: 'multi',
    subject: personSubject({
      canonical: personDirector,
      related: Array.from({ length: 15 }, (_, i) =>
        makeCompany(`00000000-0000-4000-a000-0000000014${String(i).padStart(2, '0')}`, i < 4),
      ),
    }),
    expect: { matched: true, minStrength: 0.85 },
  },
];

runPatternFixtures(pattern, fixtures);
