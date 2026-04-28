import pattern from '../../src/category-h/p-h-003-holiday-publication-burst.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

// May 19 is the eve of National Day (May 20).
const eveNationalDay1 = evt('award', {}, { publishedAt: '2026-05-19T18:00:00Z' });
const eveNationalDay2 = evt('award', {}, { publishedAt: '2026-05-19T20:30:00Z' });
const eveNationalDay3 = evt('award', {}, { publishedAt: '2026-05-19T22:00:00Z' });
// Late Friday before a long weekend.
const lateFriday1 = evt('award', {}, { publishedAt: '2026-04-03T20:00:00Z' });
const lateFriday2 = evt('award', {}, { publishedAt: '2026-04-03T21:30:00Z' });
const lateFriday3 = evt('award', {}, { publishedAt: '2026-04-03T22:30:00Z' });
// Year-end window.
const yearEnd1 = evt('award', {}, { publishedAt: '2026-12-27T10:00:00Z' });
const yearEnd2 = evt('award', {}, { publishedAt: '2026-12-30T11:00:00Z' });
const yearEnd3 = evt('award', {}, { publishedAt: '2026-12-31T15:00:00Z' });
// Normal mid-week, mid-day.
const normal1 = evt('award', {}, { publishedAt: '2026-06-10T11:00:00Z' });
const normal2 = evt('award', {}, { publishedAt: '2026-06-11T14:00:00Z' });
const normal3 = evt('award', {}, { publishedAt: '2026-06-12T10:00:00Z' });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: '3 publications on the eve of National Day',
    kind: 'TP',
    subject: tenderSubject({ events: [eveNationalDay1, eveNationalDay2, eveNationalDay3] }),
    expect: { matched: true, minStrength: 0.4 },
  },
  {
    name: '3 late-Friday publications before long weekend',
    kind: 'TP',
    subject: tenderSubject({ events: [lateFriday1, lateFriday2, lateFriday3] }),
    expect: { matched: true, minStrength: 0.4 },
  },
  {
    name: '3 year-end publications (Dec 27–31)',
    kind: 'TP',
    subject: tenderSubject({ events: [yearEnd1, yearEnd2, yearEnd3] }),
    expect: { matched: true, minStrength: 0.4 },
  },
  {
    name: '3 normal mid-week publications',
    kind: 'TN',
    subject: tenderSubject({ events: [normal1, normal2, normal3] }),
    expect: { matched: false },
  },
  {
    name: 'fewer than 3 dated events',
    kind: 'TN',
    subject: tenderSubject({ events: [eveNationalDay1, eveNationalDay2] }),
    expect: { matched: false, mustMentionInRationale: 'too few dated' },
  },
  {
    name: 'mix — 1 holiday-eve + 2 normal — minority bursts',
    kind: 'edge',
    subject: tenderSubject({ events: [eveNationalDay1, normal1, normal2] }),
    expect: { matched: false },
  },
];

runPatternFixtures(pattern, fixtures);
