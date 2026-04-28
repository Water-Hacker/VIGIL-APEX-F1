import pattern from '../../src/category-c/p-c-002-unit-price-anomaly.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const cleanLines = evt('award', {
  line_items: [
    { description: 'cement-50kg', unit_price_xaf: 5_000, benchmark_xaf: 5_000 },
    { description: 'rebar-12mm', unit_price_xaf: 1_200, benchmark_xaf: 1_200 },
  ],
});
const oneInflated = evt('award', {
  line_items: [
    { description: 'cement-50kg', unit_price_xaf: 5_000, benchmark_xaf: 5_000 },
    { description: 'rebar-12mm', unit_price_xaf: 4_500, benchmark_xaf: 1_200 }, // 3.75×
  ],
});
const slightlyOver = evt('award', {
  line_items: [{ description: 'cement-50kg', unit_price_xaf: 6_500, benchmark_xaf: 5_000 }], // 1.3×
});
const noBenchmark = evt('award', {
  line_items: [{ description: 'cement-50kg', unit_price_xaf: 5_000 }],
});
const empty = evt('award', { line_items: [] });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'one line item at 3.75× benchmark',
    kind: 'TP',
    subject: tenderSubject({ events: [oneInflated] }),
    expect: { matched: true, minStrength: 0.85, mustMentionInRationale: 'rebar' },
  },
  {
    name: 'all line items within benchmark',
    kind: 'TN',
    subject: tenderSubject({ events: [cleanLines] }),
    expect: { matched: false },
  },
  {
    name: 'line item only 1.3× benchmark — below 1.5× threshold',
    kind: 'edge',
    subject: tenderSubject({ events: [slightlyOver] }),
    expect: { matched: false, mustMentionInRationale: 'no line item above' },
  },
  {
    name: 'line items present but no benchmark recorded',
    kind: 'TN',
    subject: tenderSubject({ events: [noBenchmark] }),
    expect: { matched: false },
  },
  {
    name: 'no line items at all',
    kind: 'TN',
    subject: tenderSubject({ events: [empty] }),
    expect: { matched: false },
  },
  {
    name: 'no award event',
    kind: 'TN',
    subject: tenderSubject({ events: [] }),
    expect: { matched: false, mustMentionInRationale: 'no award' },
  },
];

runPatternFixtures(pattern, fixtures);
