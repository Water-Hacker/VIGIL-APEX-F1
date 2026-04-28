import pattern from '../../src/category-c/p-c-001-price-above-benchmark.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const wayOver = evt('award', { amount_xaf: 200_000_000, benchmark_amount_xaf: 100_000_000 }); // 2.0×
const slightlyOver = evt('award', { amount_xaf: 130_000_000, benchmark_amount_xaf: 100_000_000 }); // 1.3×
const onBudget = evt('award', { amount_xaf: 105_000_000, benchmark_amount_xaf: 100_000_000 }); // 1.05×
const noBenchmark = evt('award', { amount_xaf: 200_000_000 });
const tenderEvent = evt('tender_published', { amount_xaf: 100_000_000, benchmark_amount_xaf: 50_000_000 });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'awarded amount 2× the benchmark',
    kind: 'TP',
    subject: tenderSubject({ events: [wayOver] }),
    expect: { matched: true, minStrength: 0.45, mustMentionInRationale: 'ratio' },
  },
  {
    name: 'awarded amount exactly at the 1.3× threshold — strength below match cut-off',
    kind: 'edge',
    subject: tenderSubject({ events: [slightlyOver] }),
    // strength = (1.3 - 1) / 2 = 0.15, below the 0.3 match threshold
    expect: { matched: false, maxStrength: 0.16 },
  },
  {
    name: 'awarded amount only 5% over benchmark',
    kind: 'TN',
    subject: tenderSubject({ events: [onBudget] }),
    expect: { matched: false },
  },
  {
    name: 'no benchmark recorded — pattern abstains',
    kind: 'TN',
    subject: tenderSubject({ events: [noBenchmark] }),
    expect: { matched: false, mustMentionInRationale: 'benchmark missing' },
  },
  {
    name: 'no award event at all',
    kind: 'TN',
    subject: tenderSubject({ events: [tenderEvent] }),
    expect: { matched: false, mustMentionInRationale: 'no award' },
  },
  {
    name: 'far over benchmark — pattern saturates near 1.0',
    kind: 'multi',
    subject: tenderSubject({
      events: [evt('award', { amount_xaf: 500_000_000, benchmark_amount_xaf: 100_000_000 })],
    }),
    expect: { matched: true, minStrength: 0.95 },
  },
];

runPatternFixtures(pattern, fixtures);
