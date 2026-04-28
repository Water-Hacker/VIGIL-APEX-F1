import pattern from '../../src/category-a/p-a-006-uneven-bid-spread.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

// Classic complementary-bidding shape:
//   winner 100M, next 108M (8% gap), three clustered 108-110M, outlier 200M.
const cbAward = evt('award', {
  bids: [
    { amount_xaf: 100_000_000 },
    { amount_xaf: 108_000_000 },
    { amount_xaf: 109_500_000 },
    { amount_xaf: 110_000_000 },
    { amount_xaf: 200_000_000 },
  ],
});
// Healthy distribution: wide spread, no clustering.
const healthyAward = evt('award', {
  bids: [
    { amount_xaf: 90_000_000 },
    { amount_xaf: 105_000_000 },
    { amount_xaf: 120_000_000 },
    { amount_xaf: 135_000_000 },
    { amount_xaf: 150_000_000 },
  ],
});
// Tight cluster but no outlier.
const noOutlier = evt('award', {
  bids: [
    { amount_xaf: 100_000_000 },
    { amount_xaf: 108_000_000 },
    { amount_xaf: 109_000_000 },
    { amount_xaf: 109_500_000 },
    { amount_xaf: 110_000_000 },
  ],
});
// Only 4 bids — pattern requires ≥ 5.
const tooFewBids = evt('award', {
  bids: [
    { amount_xaf: 100_000_000 },
    { amount_xaf: 108_000_000 },
    { amount_xaf: 109_000_000 },
    { amount_xaf: 200_000_000 },
  ],
});
// Win-gap too small (3%) — does not meet the 5-12% complementary-bidding window.
const tightWin = evt('award', {
  bids: [
    { amount_xaf: 100_000_000 },
    { amount_xaf: 103_000_000 },
    { amount_xaf: 103_500_000 },
    { amount_xaf: 104_000_000 },
    { amount_xaf: 200_000_000 },
  ],
});

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'classic complementary-bidding distribution',
    kind: 'TP',
    subject: tenderSubject({ events: [cbAward] }),
    expect: { matched: true, minStrength: 0.85 },
  },
  {
    name: 'healthy spread — no rigging signal',
    kind: 'TN',
    subject: tenderSubject({ events: [healthyAward] }),
    expect: { matched: false },
  },
  {
    name: 'tight cluster but no high-end outlier — partial signal',
    kind: 'edge',
    subject: tenderSubject({ events: [noOutlier] }),
    // Win-gap (8%) + tight-cluster contributions only — strength 0.65, matches.
    expect: { matched: true, minStrength: 0.5, maxStrength: 0.7 },
  },
  {
    name: 'fewer than 5 bids',
    kind: 'TN',
    subject: tenderSubject({ events: [tooFewBids] }),
    expect: { matched: false, mustMentionInRationale: 'fewer than 5' },
  },
  {
    name: 'win-gap below the 5-12% rigging window',
    kind: 'TN',
    subject: tenderSubject({ events: [tightWin] }),
    // No win-gap contribution; tight-cluster contribution + outlier contribution might bring partial.
    expect: { matched: true, minStrength: 0.4, maxStrength: 0.7 },
  },
  {
    name: 'no award event',
    kind: 'TN',
    subject: tenderSubject({ events: [] }),
    expect: { matched: false, mustMentionInRationale: 'no award' },
  },
];

runPatternFixtures(pattern, fixtures);
