import pattern from '../../src/category-c/p-c-003-quantity-mismatch.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const award = evt('award', {
  line_items: [
    { description: 'cement-50kg', qty: 1_000 },
    { description: 'rebar-12mm', qty: 500 },
  ],
});
const paymentMatching = evt('payment_order', {
  line_items: [
    { description: 'cement-50kg', qty: 1_000 },
    { description: 'rebar-12mm', qty: 500 },
  ],
});
const paymentInflated = evt('payment_order', {
  line_items: [
    { description: 'cement-50kg', qty: 1_000 },
    { description: 'rebar-12mm', qty: 800 }, // +60%
  ],
});
const paymentSlightlyHigh = evt('payment_order', {
  line_items: [
    { description: 'cement-50kg', qty: 1_100 }, // +10% (under threshold)
    { description: 'rebar-12mm', qty: 500 },
  ],
});
const paymentDifferentLine = evt('payment_order', {
  line_items: [{ description: 'gravel-tonne', qty: 5_000 }],
});

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'invoiced qty +60% over specified',
    kind: 'TP',
    subject: tenderSubject({ events: [award, paymentInflated] }),
    expect: { matched: true, minStrength: 0.4, mustMentionInRationale: 'rebar' },
  },
  {
    name: 'invoiced qty matches spec',
    kind: 'TN',
    subject: tenderSubject({ events: [award, paymentMatching] }),
    expect: { matched: false, mustMentionInRationale: 'no quantity overrun' },
  },
  {
    name: 'invoiced +10% — under 30% threshold',
    kind: 'TN',
    subject: tenderSubject({ events: [award, paymentSlightlyHigh] }),
    expect: { matched: false },
  },
  {
    name: 'payment lines reference items not in spec',
    kind: 'edge',
    subject: tenderSubject({ events: [award, paymentDifferentLine] }),
    expect: { matched: false },
  },
  {
    name: 'no payment event',
    kind: 'TN',
    subject: tenderSubject({ events: [award] }),
    expect: { matched: false, mustMentionInRationale: 'missing award or payment' },
  },
  {
    name: 'spec has empty line_items',
    kind: 'TN',
    subject: tenderSubject({
      events: [evt('award', { line_items: [] }), paymentInflated],
    }),
    expect: { matched: false, mustMentionInRationale: 'no line items' },
  },
];

runPatternFixtures(pattern, fixtures);
