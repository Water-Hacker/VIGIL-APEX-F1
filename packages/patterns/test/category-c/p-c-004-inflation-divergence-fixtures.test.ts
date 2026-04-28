import pattern from '../../src/category-c/p-c-004-inflation-divergence.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const bigGap = evt('award', { escalation_pct: 18, cpi_pct_over_period: 4 }); // gap 14
const moderateGap = evt('award', { escalation_pct: 9, cpi_pct_over_period: 4 }); // gap 5
const smallGap = evt('award', { escalation_pct: 5, cpi_pct_over_period: 4 }); // gap 1, under threshold
const equal = evt('award', { escalation_pct: 6, cpi_pct_over_period: 6 });
const missingCpi = evt('award', { escalation_pct: 8 });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'escalation 18% vs CPI 4% — large divergence',
    kind: 'TP',
    subject: tenderSubject({ events: [bigGap] }),
    expect: { matched: true, minStrength: 0.95 },
  },
  {
    name: 'escalation 5pp above CPI — moderate divergence',
    kind: 'TP',
    subject: tenderSubject({ events: [moderateGap] }),
    expect: { matched: true, minStrength: 0.35 },
  },
  {
    name: '1pp gap — under 3pp threshold',
    kind: 'TN',
    subject: tenderSubject({ events: [smallGap] }),
    expect: { matched: false, mustMentionInRationale: 'gap=' },
  },
  {
    name: 'escalation tracks CPI exactly',
    kind: 'TN',
    subject: tenderSubject({ events: [equal] }),
    expect: { matched: false },
  },
  {
    name: 'CPI not recorded — pattern abstains',
    kind: 'TN',
    subject: tenderSubject({ events: [missingCpi] }),
    expect: { matched: false, mustMentionInRationale: 'missing escalation or CPI' },
  },
  {
    name: 'no award event',
    kind: 'TN',
    subject: tenderSubject({ events: [] }),
    expect: { matched: false, mustMentionInRationale: 'no award' },
  },
];

runPatternFixtures(pattern, fixtures);
