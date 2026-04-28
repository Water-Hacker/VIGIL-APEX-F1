/**
 * Detailed reference fixtures for P-B-007 (Politically-Exposed Person link).
 * Companion to the baseline 5-case sweep in `_registry-baseline.test.ts`;
 * focuses on the TP / edge / multi shapes the baseline cannot exercise.
 */
import pattern from '../../src/category-b/p-b-007-pep-link.js';

import { companySubject, runPatternFixtures, type PatternFixture } from '../_harness.js';

const pepCanonical = {
  id: '00000000-0000-4000-a000-000000000201',
  kind: 'person' as const,
  display_name: 'M. Test PEP',
  rccm_number: null,
  niu: null,
  jurisdiction: 'Cameroun',
  region: 'CE' as const,
  eth_address: null,
  is_pep: true,
  is_sanctioned: false,
  sanctioned_lists: [] as string[],
  first_seen: '2020-01-01T00:00:00Z',
  last_seen: '2026-01-01T00:00:00Z',
  resolution_confidence: 0.95,
  resolved_by: 'rule' as const,
};
const cleanCanonical = { ...pepCanonical, id: '00000000-0000-4000-a000-000000000202', is_pep: false };

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'company has direct PEP director',
    kind: 'TP',
    subject: companySubject({ related: [pepCanonical] }),
    expect: { matched: true, minStrength: 0.5, mustMentionInRationale: 'pep' },
  },
  {
    name: 'company has only non-PEP related entities',
    kind: 'TN',
    subject: companySubject({ related: [cleanCanonical] }),
    expect: { matched: false },
  },
  {
    name: 'no related entities at all',
    kind: 'TN',
    subject: companySubject({ related: [] }),
    expect: { matched: false },
  },
  {
    name: 'PEP among many non-PEPs (still positive)',
    kind: 'edge',
    subject: companySubject({
      related: [cleanCanonical, cleanCanonical, pepCanonical, cleanCanonical],
    }),
    expect: { matched: true, minStrength: 0.4 },
  },
  {
    name: 'multiple PEPs raises strength',
    kind: 'multi',
    subject: companySubject({
      related: [pepCanonical, { ...pepCanonical, id: '00000000-0000-4000-a000-000000000203' }],
    }),
    expect: { matched: true, minStrength: 0.7 },
  },
];

runPatternFixtures(pattern, fixtures);
