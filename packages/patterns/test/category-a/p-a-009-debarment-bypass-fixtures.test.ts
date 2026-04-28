import pattern from '../../src/category-a/p-a-009-debarment-bypass.js';

import { companySubject, evt, runPatternFixtures, type PatternFixture } from '../_harness.js';

const baseCompany = {
  id: '00000000-0000-4000-a000-000000000601',
  kind: 'company' as const,
  display_name: 'Bidder Co.',
  rccm_number: 'CM-DLA-2022-B-66666',
  niu: 'M5555555555',
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
const debarredOneList = { ...baseCompany, is_sanctioned: true, sanctioned_lists: ['WORLD-BANK-DEBAR'] };
const debarredMultiList = {
  ...baseCompany,
  is_sanctioned: true,
  sanctioned_lists: ['WORLD-BANK-DEBAR', 'AFDB-INELIG'],
};
const sanctionedRelatedDirector = {
  ...baseCompany,
  id: '00000000-0000-4000-a000-000000000602',
  kind: 'person' as const,
  display_name: 'M. Debarred Director',
  is_sanctioned: true,
  sanctioned_lists: ['OFAC-SDN'],
};
const cleanRelated = { ...baseCompany, id: '00000000-0000-4000-a000-000000000603' };
const award = evt('award', {}, { publishedAt: '2026-04-15T00:00:00Z' });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'company on a single debarment list, current award',
    kind: 'TP',
    subject: companySubject({ canonical: debarredOneList, events: [award] }),
    expect: { matched: true, minStrength: 0.8 },
  },
  {
    name: 'multi-list debarment — strength bumps to 0.95',
    kind: 'TP',
    subject: companySubject({ canonical: debarredMultiList, events: [award] }),
    expect: { matched: true, minStrength: 0.94 },
  },
  {
    name: 'company itself clean, but a related director debarred',
    kind: 'multi',
    subject: companySubject({
      canonical: baseCompany,
      related: [sanctionedRelatedDirector],
      events: [award],
    }),
    expect: { matched: true, minStrength: 0.8 },
  },
  {
    name: 'no sanction exposure on the bidder or related parties',
    kind: 'TN',
    subject: companySubject({ canonical: baseCompany, related: [cleanRelated], events: [award] }),
    expect: { matched: false, mustMentionInRationale: 'no sanction' },
  },
  {
    name: 'sanctioned but no award event',
    kind: 'TN',
    subject: companySubject({ canonical: debarredOneList, events: [] }),
    expect: { matched: false, mustMentionInRationale: 'missing canonical or award' },
  },
  {
    name: 'no canonical resolved',
    kind: 'edge',
    subject: companySubject({ canonical: null, events: [award] }),
    expect: { matched: false },
  },
];

runPatternFixtures(pattern, fixtures);
