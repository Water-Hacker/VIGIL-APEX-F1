import pattern from '../../src/category-h/p-h-001-award-before-tender-close.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const tender = evt('tender_notice', { close_at: '2026-04-30T00:00:00Z' });
const awardAfter = evt('award', { supplier_name: 'Société Late SARL' }, { publishedAt: '2026-05-05T00:00:00Z' });
const awardOneDayBefore = evt('award', { supplier_name: 'Société Cheat SARL' }, { publishedAt: '2026-04-29T00:00:00Z' });
const awardWeekBefore = evt('award', { supplier_name: 'Société Rig SARL' }, { publishedAt: '2026-04-23T00:00:00Z' });
const awardThreeWeeksBefore = evt(
  'award',
  { supplier_name: 'Société Way-Early SARL' },
  { publishedAt: '2026-04-09T00:00:00Z' },
);

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'award one week before tender close',
    kind: 'TP',
    subject: tenderSubject({ events: [tender, awardWeekBefore] }),
    expect: { matched: true, minStrength: 0.45, mustMentionInRationale: 'before tender-close' },
  },
  {
    name: 'award three weeks before — strength saturates near 1',
    kind: 'TP',
    subject: tenderSubject({ events: [tender, awardThreeWeeksBefore] }),
    expect: { matched: true, minStrength: 0.95 },
  },
  {
    name: 'award one day before — small but still flags',
    kind: 'edge',
    subject: tenderSubject({ events: [tender, awardOneDayBefore] }),
    // 1d / 14 = 0.071 — below the 0.3 match threshold
    expect: { matched: false, maxStrength: 0.08 },
  },
  {
    name: 'award after tender close (normal procurement)',
    kind: 'TN',
    subject: tenderSubject({ events: [tender, awardAfter] }),
    expect: { matched: false, mustMentionInRationale: 'normal' },
  },
  {
    name: 'tender notice missing',
    kind: 'TN',
    subject: tenderSubject({ events: [awardAfter] }),
    expect: { matched: false, mustMentionInRationale: 'missing' },
  },
  {
    name: 'multi — both early-award AND no close_at recorded',
    kind: 'multi',
    subject: tenderSubject({
      events: [
        evt('tender_notice', { /* no close_at */ }),
        awardWeekBefore,
      ],
    }),
    expect: { matched: false, mustMentionInRationale: 'missing dates' },
  },
];

runPatternFixtures(pattern, fixtures);
