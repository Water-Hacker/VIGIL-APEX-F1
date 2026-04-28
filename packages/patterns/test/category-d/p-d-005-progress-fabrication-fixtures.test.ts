import pattern from '../../src/category-d/p-d-005-progress-fabrication.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const reportFeb = evt('investment_project', { progress_pct: 10 }, { publishedAt: '2026-02-01T00:00:00Z' });
const reportMay = evt('investment_project', { progress_pct: 35 }, { publishedAt: '2026-05-01T00:00:00Z' });
const reportAug = evt('investment_project', { progress_pct: 70 }, { publishedAt: '2026-08-01T00:00:00Z' });
const satFebFlat = evt('satellite_imagery', { activity_score: 0.05 }, { publishedAt: '2026-02-01T00:00:00Z' });
const satAugFlat = evt('satellite_imagery', { activity_score: 0.06 }, { publishedAt: '2026-08-01T00:00:00Z' });
const satAugBuilt = evt('satellite_imagery', { activity_score: 0.55 }, { publishedAt: '2026-08-01T00:00:00Z' });
// Need observed_at on satellites — set via the published_at default; the evt helper observed_at
// is already '2026-04-01T10:00:00Z' but the pattern reads observed_at directly. Let me overrride:

// override observed_at for satellite events by overriding the evt result
function satWithObserved(score: number, observedAt: string) {
  const e = evt('satellite_imagery', { activity_score: score });
  return { ...e, observed_at: observedAt as typeof e.observed_at };
}
const satFebObs = satWithObserved(0.05, '2026-02-01T00:00:00Z');
const satAugFlatObs = satWithObserved(0.06, '2026-08-01T00:00:00Z');
const satAugBuiltObs = satWithObserved(0.55, '2026-08-01T00:00:00Z');

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'reports +60% progress, satellite flat',
    kind: 'TP',
    subject: tenderSubject({
      events: [reportFeb, reportMay, reportAug, satFebObs, satAugFlatObs],
    }),
    expect: { matched: true, minStrength: 0.85 },
  },
  {
    name: 'reports +60% progress, satellite confirms (~+50%)',
    kind: 'TN',
    subject: tenderSubject({
      events: [reportFeb, reportMay, reportAug, satFebObs, satAugBuiltObs],
    }),
    expect: { matched: false, mustMentionInRationale: 'satellite confirms' },
  },
  {
    name: 'fewer than 3 progress reports',
    kind: 'TN',
    subject: tenderSubject({
      events: [reportFeb, reportMay, satFebObs, satAugFlatObs],
    }),
    expect: { matched: false, mustMentionInRationale: 'insufficient' },
  },
  {
    name: 'reports show only +5% — does not meet "consistent progress" threshold',
    kind: 'TN',
    subject: tenderSubject({
      events: [
        reportFeb,
        evt('investment_project', { progress_pct: 12 }, { publishedAt: '2026-05-01T00:00:00Z' }),
        evt('investment_project', { progress_pct: 15 }, { publishedAt: '2026-08-01T00:00:00Z' }),
        satFebObs,
        satAugFlatObs,
      ],
    }),
    expect: { matched: false, mustMentionInRationale: 'reported delta' },
  },
  {
    name: 'reports without satellite imagery',
    kind: 'TN',
    subject: tenderSubject({ events: [reportFeb, reportMay, reportAug] }),
    expect: { matched: false, mustMentionInRationale: 'insufficient' },
  },
  {
    name: 'four reports, two satellites — pattern keys on first/last activity delta',
    kind: 'multi',
    subject: tenderSubject({
      events: [
        reportFeb,
        reportMay,
        reportAug,
        evt('investment_project', { progress_pct: 90 }, { publishedAt: '2026-11-01T00:00:00Z' }),
        satFebObs,
        satAugFlatObs,
      ],
    }),
    expect: { matched: true, minStrength: 0.95 },
  },
];

runPatternFixtures(pattern, fixtures);
