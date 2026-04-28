import pattern from '../../src/category-d/p-d-002-incomplete-construction.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const completion = evt('investment_project', { completion_certified: true });
const completionFalse = evt('investment_project', { completion_certified: false });
const satTrace = evt('satellite_imagery', { activity_score: 0.10 });
const satPartial = evt('satellite_imagery', { activity_score: 0.45 });
const satFull = evt('satellite_imagery', { activity_score: 0.95 });
const satOnEdge = evt('satellite_imagery', { activity_score: 0.69 });
const satNoScore = evt('satellite_imagery', {});

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'certified completion + satellite shows trace activity',
    kind: 'TP',
    subject: tenderSubject({ events: [completion, satTrace] }),
    expect: { matched: true, minStrength: 0.85, mustMentionInRationale: 'completion certified' },
  },
  {
    name: 'certified completion + 45% activity (partial)',
    kind: 'TP',
    subject: tenderSubject({ events: [completion, satPartial] }),
    expect: { matched: true, minStrength: 0.3 },
  },
  {
    name: 'activity at 69% — just under 70% threshold, fires weakly',
    kind: 'edge',
    subject: tenderSubject({ events: [completion, satOnEdge] }),
    // (0.7 - 0.69) * 1.5 = 0.015
    expect: { matched: true, minStrength: 0.005, maxStrength: 0.05 },
  },
  {
    name: 'certified completion + full satellite activity (project actually done)',
    kind: 'TN',
    subject: tenderSubject({ events: [completion, satFull] }),
    expect: { matched: false, mustMentionInRationale: 'activity=0.95' },
  },
  {
    name: 'satellite shows little activity but completion NOT certified',
    kind: 'TN',
    subject: tenderSubject({ events: [completionFalse, satTrace] }),
    expect: { matched: false, mustMentionInRationale: 'missing completion' },
  },
  {
    name: 'satellite event missing activity_score',
    kind: 'TN',
    subject: tenderSubject({ events: [completion, satNoScore] }),
    expect: { matched: false, mustMentionInRationale: 'no activity_score' },
  },
  {
    name: 'no satellite event at all',
    kind: 'TN',
    subject: tenderSubject({ events: [completion] }),
    expect: { matched: false, mustMentionInRationale: 'missing completion or satellite' },
  },
];

runPatternFixtures(pattern, fixtures);
