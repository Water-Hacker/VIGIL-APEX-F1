import pattern from '../../src/category-c/p-c-005-currency-arbitrage.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

// XAF/EUR around 656 is the standard fixed peg.
const wideGap = evt('payment_order', { invoice_rate: 720, beac_fixing_rate: 656 }); // ~9.7% gap
const moderateGap = evt('payment_order', { invoice_rate: 690, beac_fixing_rate: 656 }); // ~5.2%
const tinyGap = evt('payment_order', { invoice_rate: 660, beac_fixing_rate: 656 }); // ~0.6%
const noFixing = evt('payment_order', { invoice_rate: 720 });
const treasury = evt('treasury_disbursement', { invoice_rate: 720, beac_fixing_rate: 656 });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'invoice 9.7% above BEAC fixing',
    kind: 'TP',
    subject: tenderSubject({ events: [wideGap] }),
    expect: { matched: true, minStrength: 0.45 },
  },
  {
    name: 'treasury disbursement with arbitrage gap',
    kind: 'TP',
    subject: tenderSubject({ events: [treasury] }),
    expect: { matched: true, minStrength: 0.45 },
  },
  {
    name: 'gap 5.2% — material but lower strength',
    kind: 'edge',
    subject: tenderSubject({ events: [moderateGap] }),
    expect: { matched: true, minStrength: 0.05, maxStrength: 0.15 },
  },
  {
    name: 'gap 0.6% — within tolerance',
    kind: 'TN',
    subject: tenderSubject({ events: [tinyGap] }),
    expect: { matched: false, mustMentionInRationale: 'gap=' },
  },
  {
    name: 'BEAC fixing not recorded',
    kind: 'TN',
    subject: tenderSubject({ events: [noFixing] }),
    expect: { matched: false, mustMentionInRationale: 'missing rates' },
  },
  {
    name: 'no payment event',
    kind: 'TN',
    subject: tenderSubject({ events: [] }),
    expect: { matched: false, mustMentionInRationale: 'no payment' },
  },
];

runPatternFixtures(pattern, fixtures);
