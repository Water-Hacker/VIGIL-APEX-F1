import pattern from '../../src/category-g/p-g-004-font-anomaly.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const strongAnomaly = evt('amendment', { font_anomaly_score: 0.92 });
const moderate = evt('amendment', { font_anomaly_score: 0.65 });
const justUnder = evt('amendment', { font_anomaly_score: 0.59 });
const veryLow = evt('amendment', { font_anomaly_score: 0.10 });
const noScore = evt('amendment', {});
const wrongType = evt('amendment', { font_anomaly_score: 'high' });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'font anomaly score 0.92',
    kind: 'TP',
    subject: tenderSubject({ events: [strongAnomaly] }),
    expect: { matched: true, minStrength: 0.9 },
  },
  {
    name: 'score 0.65 — moderate signal',
    kind: 'TP',
    subject: tenderSubject({ events: [moderate] }),
    expect: { matched: true, minStrength: 0.6 },
  },
  {
    name: 'score 0.59 — just under 0.6 threshold',
    kind: 'TN',
    subject: tenderSubject({ events: [justUnder] }),
    expect: { matched: false, mustMentionInRationale: 'no font anomaly' },
  },
  {
    name: 'score very low — clean document',
    kind: 'TN',
    subject: tenderSubject({ events: [veryLow] }),
    expect: { matched: false },
  },
  {
    name: 'no score field on the event',
    kind: 'TN',
    subject: tenderSubject({ events: [noScore] }),
    expect: { matched: false },
  },
  {
    name: 'multiple events, takes the highest score',
    kind: 'multi',
    subject: tenderSubject({ events: [veryLow, moderate, strongAnomaly] }),
    expect: { matched: true, minStrength: 0.9 },
  },
  {
    name: 'wrong type — pattern skips that event',
    kind: 'edge',
    subject: tenderSubject({ events: [wrongType] }),
    expect: { matched: false },
  },
];

runPatternFixtures(pattern, fixtures);
