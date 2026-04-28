import pattern from '../../src/category-f/p-f-001-round-trip-payment.js';

import { companySubject, runPatternFixtures, type PatternFixture } from '../_harness.js';

const baseCompany = {
  id: '00000000-0000-4000-a000-000000000a01',
  kind: 'company' as const,
  display_name: 'Bidder Co.',
  rccm_number: 'CM-DLA-2022-B-12121',
  niu: 'M3322221111',
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
const oneHop = { ...baseCompany, metadata: { roundTripDetected: true, roundTripHops: 1 } };
const twoHop = { ...baseCompany, metadata: { roundTripDetected: true, roundTripHops: 2 } };
const fourHop = { ...baseCompany, metadata: { roundTripDetected: true, roundTripHops: 4 } };
const flaggedNoHops = { ...baseCompany, metadata: { roundTripDetected: true } };
const noFlag = { ...baseCompany, metadata: { roundTripDetected: false } };

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: '1-hop round trip — strongest signal',
    kind: 'TP',
    subject: companySubject({ canonical: oneHop }),
    expect: { matched: true, minStrength: 0.85, mustMentionInRationale: '1 hop' },
  },
  {
    name: '2-hop round trip — strong but lower',
    kind: 'TP',
    subject: companySubject({ canonical: twoHop }),
    expect: { matched: true, minStrength: 0.6, maxStrength: 0.8 },
  },
  {
    name: '4-hop round trip — degraded confidence',
    kind: 'edge',
    subject: companySubject({ canonical: fourHop }),
    expect: { matched: true, minStrength: 0.5, maxStrength: 0.65 },
  },
  {
    name: 'flag set without hop count — defaults to 0 → still matches',
    kind: 'edge',
    subject: companySubject({ canonical: flaggedNoHops }),
    expect: { matched: true, minStrength: 0.85 },
  },
  {
    name: 'roundTripDetected explicitly false',
    kind: 'TN',
    subject: companySubject({ canonical: noFlag }),
    expect: { matched: false, mustMentionInRationale: 'no round-trip' },
  },
  {
    name: 'no canonical resolved',
    kind: 'TN',
    subject: companySubject({ canonical: null }),
    expect: { matched: false, mustMentionInRationale: 'no canonical' },
  },
  {
    name: 'metadata bag empty (no flag at all)',
    kind: 'TN',
    subject: companySubject({ canonical: baseCompany }),
    expect: { matched: false },
  },
];

runPatternFixtures(pattern, fixtures);
