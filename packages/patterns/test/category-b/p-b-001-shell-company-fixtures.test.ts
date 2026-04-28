import pattern from '../../src/category-b/p-b-001-shell-company.js';

import { companySubject, evt, runPatternFixtures, type PatternFixture } from '../_harness.js';

const baseCompany = {
  id: '00000000-0000-4000-a000-000000000701',
  kind: 'company' as const,
  display_name: 'Bidder Co.',
  rccm_number: 'CM-DLA-2026-B-99999',
  niu: 'M1112223334',
  jurisdiction: 'Cameroun',
  region: 'CE' as const,
  eth_address: null,
  is_pep: false,
  is_sanctioned: false,
  sanctioned_lists: [] as string[],
  first_seen: '2026-02-01T00:00:00Z',
  last_seen: '2026-04-01T00:00:00Z',
  resolution_confidence: 0.95,
  resolved_by: 'rule' as const,
  metadata: {},
};
const directorPep = {
  ...baseCompany,
  id: '00000000-0000-4000-a000-000000000702',
  kind: 'person' as const,
  display_name: 'M. Director',
  is_pep: true,
};
const cleanDirector = { ...directorPep, id: '00000000-0000-4000-a000-000000000703', is_pep: false };

const incorpRecent = evt('company_filing', { filing_kind: 'incorporation' }, { publishedAt: '2026-02-01T00:00:00Z' });
const incorpOld = evt('company_filing', { filing_kind: 'incorporation' }, { publishedAt: '2020-01-15T00:00:00Z' });
const award = evt('award', {}, { publishedAt: '2026-04-15T00:00:00Z' });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'incorporated 73 days before award + single PEP director',
    kind: 'TP',
    subject: companySubject({
      canonical: baseCompany,
      related: [directorPep],
      events: [incorpRecent, award],
    }),
    expect: { matched: true, minStrength: 0.85 },
  },
  {
    name: 'rapid incorporation only, no PEP director',
    kind: 'TP',
    subject: companySubject({
      canonical: baseCompany,
      related: [cleanDirector],
      events: [incorpRecent, award],
    }),
    // 0.55 (rapid) + 0.2 (single director) = 0.75
    expect: { matched: true, minStrength: 0.7 },
  },
  {
    name: 'old incorporation — well-established company',
    kind: 'TN',
    subject: companySubject({
      canonical: baseCompany,
      related: [cleanDirector, cleanDirector],
      events: [incorpOld, award],
    }),
    expect: { matched: false },
  },
  {
    name: 'no incorporation event recorded',
    kind: 'TN',
    subject: companySubject({ canonical: baseCompany, events: [award] }),
    expect: { matched: false, mustMentionInRationale: 'no incorporation' },
  },
  {
    name: 'no award event',
    kind: 'TN',
    subject: companySubject({ canonical: baseCompany, events: [incorpRecent] }),
    expect: { matched: false, mustMentionInRationale: 'no award' },
  },
  {
    name: 'subject is not a company kind',
    kind: 'edge',
    subject: companySubject({ canonical: { ...directorPep, kind: 'person' as const } }),
    expect: { matched: false, mustMentionInRationale: 'no company' },
  },
];

runPatternFixtures(pattern, fixtures);
