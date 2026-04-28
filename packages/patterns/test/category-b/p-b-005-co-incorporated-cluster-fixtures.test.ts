import pattern from '../../src/category-b/p-b-005-co-incorporated-cluster.js';

import { companySubject, runPatternFixtures, type PatternFixture } from '../_harness.js';

const baseCompany = {
  id: '00000000-0000-4000-a000-000000000f01',
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

function peer(id: string, communityId?: number) {
  return {
    ...baseCompany,
    id: `00000000-0000-4000-a000-000000001${id}`,
    metadata: communityId === undefined ? {} : { communityId },
  };
}

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: '4 peers in the same community',
    kind: 'TP',
    subject: companySubject({
      canonical: baseCompany,
      related: [peer('001', 42), peer('002', 42), peer('003', 42), peer('004', 42)],
      metrics: { communityId: 42 },
    }),
    expect: { matched: true, minStrength: 0.6 },
  },
  {
    name: '6 peers — strength climbs',
    kind: 'TP',
    subject: companySubject({
      canonical: baseCompany,
      related: [
        peer('001', 7),
        peer('002', 7),
        peer('003', 7),
        peer('004', 7),
        peer('005', 7),
        peer('006', 7),
      ],
      metrics: { communityId: 7 },
    }),
    expect: { matched: true, minStrength: 0.7 },
  },
  {
    name: '2 peers in same community — under cluster threshold',
    kind: 'TN',
    subject: companySubject({
      canonical: baseCompany,
      related: [peer('001', 5), peer('002', 5)],
      metrics: { communityId: 5 },
    }),
    expect: { matched: false, mustMentionInRationale: 'cluster=' },
  },
  {
    name: 'subject metrics unset — pattern abstains',
    kind: 'TN',
    subject: companySubject({
      canonical: baseCompany,
      related: [peer('001', 1), peer('002', 1), peer('003', 1)],
    }),
    expect: { matched: false, mustMentionInRationale: 'community not computed' },
  },
  {
    name: 'peers in DIFFERENT communities (no co-incorporation)',
    kind: 'TN',
    subject: companySubject({
      canonical: baseCompany,
      related: [peer('001', 1), peer('002', 2), peer('003', 3)],
      metrics: { communityId: 99 },
    }),
    expect: { matched: false },
  },
  {
    name: 'peers without communityId metadata',
    kind: 'edge',
    subject: companySubject({
      canonical: baseCompany,
      related: [peer('001'), peer('002'), peer('003')],
      metrics: { communityId: 1 },
    }),
    expect: { matched: false, mustMentionInRationale: 'cluster=0' },
  },
];

runPatternFixtures(pattern, fixtures);
