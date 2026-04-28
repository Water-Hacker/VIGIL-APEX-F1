import pattern from '../../src/category-a/p-a-004-late-amendment.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

// 12-month contract: Jan 1 → Dec 31 2026.
const award = evt(
  'award',
  { amount_xaf: 100_000_000, contract_end: '2026-12-31T00:00:00Z' },
  { publishedAt: '2026-01-01T00:00:00Z' },
);
// In the last third (after Sep 1) with +50% bump.
const lateInflationary = evt(
  'amendment',
  { amount_xaf: 150_000_000 },
  { publishedAt: '2026-11-01T00:00:00Z' },
);
// Only +10%, well below threshold.
const minorAmendment = evt(
  'amendment',
  { amount_xaf: 110_000_000 },
  { publishedAt: '2026-11-01T00:00:00Z' },
);
// +50% but in the FIRST third.
const earlyBigBump = evt(
  'amendment',
  { amount_xaf: 150_000_000 },
  { publishedAt: '2026-02-15T00:00:00Z' },
);

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'amendment +50% in last third',
    kind: 'TP',
    subject: tenderSubject({ events: [award, lateInflationary] }),
    expect: { matched: true, minStrength: 0.5, mustMentionInRationale: '+50%' },
  },
  {
    name: 'small late amendment (+10%) below threshold',
    kind: 'TN',
    subject: tenderSubject({ events: [award, minorAmendment] }),
    expect: { matched: false },
  },
  {
    name: 'big amendment but in first third — pattern requires lateness',
    kind: 'TN',
    subject: tenderSubject({ events: [award, earlyBigBump] }),
    expect: { matched: false },
  },
  {
    name: 'no amendment events',
    kind: 'TN',
    subject: tenderSubject({ events: [award] }),
    expect: { matched: false, mustMentionInRationale: 'no amendment' },
  },
  {
    name: 'missing contract_end — pattern abstains',
    kind: 'edge',
    subject: tenderSubject({
      events: [
        evt('award', { amount_xaf: 100_000_000 }, { publishedAt: '2026-01-01T00:00:00Z' }),
        lateInflationary,
      ],
    }),
    expect: { matched: false, mustMentionInRationale: 'missing dates' },
  },
  {
    name: 'two amendments — only the late one fires the signal',
    kind: 'multi',
    subject: tenderSubject({ events: [award, minorAmendment, lateInflationary] }),
    expect: { matched: true, minStrength: 0.5 },
  },
];

runPatternFixtures(pattern, fixtures);
