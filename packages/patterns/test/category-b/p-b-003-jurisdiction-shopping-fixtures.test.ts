import pattern from '../../src/category-b/p-b-003-jurisdiction-shopping.js';

import { companySubject, runPatternFixtures, type PatternFixture } from '../_harness.js';

const baseOpaque = {
  id: '00000000-0000-4000-a000-000000000801',
  kind: 'company' as const,
  display_name: 'Offshore Holdings Ltd',
  rccm_number: null,
  niu: null,
  jurisdiction: 'VG', // British Virgin Islands
  region: null,
  eth_address: null,
  is_pep: false,
  is_sanctioned: false,
  sanctioned_lists: [] as string[],
  first_seen: '2024-01-01T00:00:00Z',
  last_seen: '2026-01-01T00:00:00Z',
  resolution_confidence: 0.85,
  resolved_by: 'rule' as const,
  metadata: {},
};
const opaqueWithRccm = { ...baseOpaque, rccm_number: 'CM-DLA-2024-B-00077' };
const cameroonian = { ...baseOpaque, jurisdiction: 'CM', rccm_number: 'CM-DLA-2024-B-00088' };
const opaqueLowercase = { ...baseOpaque, jurisdiction: 'sc' };
const pepDirector = {
  ...baseOpaque,
  id: '00000000-0000-4000-a000-000000000802',
  kind: 'person' as const,
  display_name: 'M. PEP',
  is_pep: true,
};

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'BVI bidder with no Cameroonian RCCM',
    kind: 'TP',
    subject: companySubject({ canonical: baseOpaque }),
    expect: { matched: true, minStrength: 0.7 },
  },
  {
    name: 'BVI bidder + PEP director — strength bumps further',
    kind: 'TP',
    subject: companySubject({ canonical: baseOpaque, related: [pepDirector] }),
    expect: { matched: true, minStrength: 0.85 },
  },
  {
    name: 'opaque jurisdiction but with Cameroonian RCCM (mitigates)',
    kind: 'edge',
    subject: companySubject({ canonical: opaqueWithRccm }),
    expect: { matched: true, minStrength: 0.5, maxStrength: 0.6 },
  },
  {
    name: 'lowercase jurisdiction code accepted',
    kind: 'edge',
    subject: companySubject({ canonical: opaqueLowercase }),
    expect: { matched: true, minStrength: 0.7 },
  },
  {
    name: 'Cameroonian-incorporated bidder',
    kind: 'TN',
    subject: companySubject({ canonical: cameroonian }),
    expect: { matched: false, mustMentionInRationale: 'not opaque' },
  },
  {
    name: 'no canonical resolved',
    kind: 'TN',
    subject: companySubject({ canonical: null }),
    expect: { matched: false },
  },
];

runPatternFixtures(pattern, fixtures);
