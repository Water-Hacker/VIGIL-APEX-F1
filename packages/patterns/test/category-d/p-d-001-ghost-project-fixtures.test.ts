import pattern from '../../src/category-d/p-d-001-ghost-project.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const noActivity = evt('satellite_imagery', { activity_score: 0.0 });
const traceActivity = evt('satellite_imagery', { activity_score: 0.05 });
const moderateActivity = evt('satellite_imagery', { activity_score: 0.45 });
const fullActivity = evt('satellite_imagery', { activity_score: 0.95 });
const investmentProject = evt('investment_project', { activity_score: 0.0 });
const disbursement = evt('treasury_disbursement', { amount_xaf: 250_000_000 });
const noActivityScore = evt('satellite_imagery', {});

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'satellite shows no activity + disbursement made',
    kind: 'TP',
    subject: tenderSubject({ events: [noActivity, disbursement] }),
    expect: { matched: true, minStrength: 0.95, mustMentionInRationale: 'satellite-activity' },
  },
  {
    name: 'investment_project event with zero activity (alt event kind)',
    kind: 'TP',
    subject: tenderSubject({ events: [investmentProject, disbursement] }),
    expect: { matched: true, minStrength: 0.95 },
  },
  {
    name: 'trace activity (5%) + disbursement — high signal',
    kind: 'TP',
    subject: tenderSubject({ events: [traceActivity, disbursement] }),
    expect: { matched: true, minStrength: 0.9 },
  },
  {
    name: 'moderate activity (45%) — partial signal, just under match',
    kind: 'edge',
    subject: tenderSubject({ events: [moderateActivity, disbursement] }),
    expect: { matched: true, minStrength: 0.5, maxStrength: 0.6 },
  },
  {
    name: 'full activity — project on track',
    kind: 'TN',
    subject: tenderSubject({ events: [fullActivity, disbursement] }),
    expect: { matched: false },
  },
  {
    name: 'no disbursement event — pattern requires corroboration',
    kind: 'TN',
    subject: tenderSubject({ events: [noActivity] }),
    expect: { matched: false, mustMentionInRationale: 'no disbursement' },
  },
  {
    name: 'satellite event without activity_score field',
    kind: 'TN',
    subject: tenderSubject({ events: [noActivityScore, disbursement] }),
    expect: { matched: false, mustMentionInRationale: 'activity_score missing' },
  },
];

runPatternFixtures(pattern, fixtures);
