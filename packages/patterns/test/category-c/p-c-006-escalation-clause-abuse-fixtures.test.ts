import pattern from '../../src/category-c/p-c-006-escalation-clause-abuse.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const earlyTrigger = evt('amendment', { clause_trigger_threshold_pct: 15, observed_input_rise_pct: 6 });
const justUnder = evt('amendment', { clause_trigger_threshold_pct: 15, observed_input_rise_pct: 14 });
const onTrigger = evt('amendment', { clause_trigger_threshold_pct: 15, observed_input_rise_pct: 15 });
const aboveTrigger = evt('amendment', { clause_trigger_threshold_pct: 15, observed_input_rise_pct: 20 });
const missingFields = evt('amendment', { clause_trigger_threshold_pct: 15 });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'clause activated at 6% vs 15% trigger — early',
    kind: 'TP',
    subject: tenderSubject({ events: [earlyTrigger] }),
    expect: { matched: true, minStrength: 0.7, mustMentionInRationale: 'premature' },
  },
  {
    name: 'observed rise 14% — just below 15% trigger, still premature',
    kind: 'edge',
    subject: tenderSubject({ events: [justUnder] }),
    expect: { matched: true, minStrength: 0.4 },
  },
  {
    name: 'observed rise exactly at trigger',
    kind: 'TN',
    subject: tenderSubject({ events: [onTrigger] }),
    expect: { matched: false, mustMentionInRationale: 'within threshold' },
  },
  {
    name: 'observed rise above trigger — legitimate activation',
    kind: 'TN',
    subject: tenderSubject({ events: [aboveTrigger] }),
    expect: { matched: false, mustMentionInRationale: 'within threshold' },
  },
  {
    name: 'amendment missing the observed-rise field',
    kind: 'TN',
    subject: tenderSubject({ events: [missingFields] }),
    expect: { matched: false, mustMentionInRationale: 'missing thresholds' },
  },
  {
    name: 'no amendment event',
    kind: 'TN',
    subject: tenderSubject({ events: [] }),
    expect: { matched: false, mustMentionInRationale: 'no amendment' },
  },
];

runPatternFixtures(pattern, fixtures);
