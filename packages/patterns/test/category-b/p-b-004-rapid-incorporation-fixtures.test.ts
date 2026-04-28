import pattern from '../../src/category-b/p-b-004-rapid-incorporation.js';

import { companySubject, evt, runPatternFixtures, type PatternFixture } from '../_harness.js';

const incorpOneDay = evt(
  'company_filing',
  { filing_kind: 'incorporation' },
  { publishedAt: '2026-04-01T00:00:00Z' },
);
const incorpTwentyEightDays = evt(
  'company_filing',
  { filing_kind: 'incorporation' },
  { publishedAt: '2026-03-01T00:00:00Z' },
);
const incorpFortyDays = evt(
  'company_filing',
  { filing_kind: 'incorporation' },
  { publishedAt: '2026-02-20T00:00:00Z' },
);
const incorpAfterTender = evt(
  'company_filing',
  { filing_kind: 'incorporation' },
  { publishedAt: '2026-04-15T00:00:00Z' }, // negative gap
);
const tenderApr2 = evt('tender_notice', {}, { publishedAt: '2026-04-02T00:00:00Z' });
const tenderApr1 = evt('tender_notice', {}, { publishedAt: '2026-04-01T00:00:00Z' });
const award = evt('award', {}, { publishedAt: '2026-04-15T00:00:00Z' });
const otherFiling = evt(
  'company_filing',
  { filing_kind: 'amendment' },
  { publishedAt: '2026-04-01T00:00:00Z' },
);

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'incorporated 1 day before tender — strength near 1',
    kind: 'TP',
    subject: companySubject({ events: [incorpOneDay, tenderApr2, award] }),
    expect: { matched: true, minStrength: 0.95 },
  },
  {
    name: 'incorporated 28 days before tender — still in sharp window',
    kind: 'TP',
    subject: companySubject({ events: [incorpTwentyEightDays, tenderApr1, award] }),
    expect: { matched: true, minStrength: 0.7 },
  },
  {
    name: 'incorporated 40 days before tender — outside sharp window',
    kind: 'TN',
    subject: companySubject({ events: [incorpFortyDays, tenderApr1, award] }),
    expect: { matched: false, mustMentionInRationale: 'gap=' },
  },
  {
    name: 'incorporated AFTER the tender — implausible negative gap',
    kind: 'TN',
    subject: companySubject({ events: [incorpAfterTender, tenderApr1, award] }),
    expect: { matched: false },
  },
  {
    name: 'filing exists but not an incorporation',
    kind: 'TN',
    subject: companySubject({ events: [otherFiling, tenderApr1, award] }),
    expect: { matched: false, mustMentionInRationale: 'missing event' },
  },
  {
    name: 'no award yet — pre-award stage',
    kind: 'edge',
    subject: companySubject({ events: [incorpOneDay, tenderApr2] }),
    expect: { matched: false, mustMentionInRationale: 'missing event' },
  },
];

runPatternFixtures(pattern, fixtures);
