import pattern from '../../src/category-e/p-e-003-sanctioned-jurisdiction-payment.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const irPayment = evt('payment_order', { beneficiary_bank_country: 'IR', amount_xaf: 500_000_000 });
const cmPayment = evt('payment_order', { beneficiary_bank_country: 'CM', amount_xaf: 500_000_000 });
const treasuryToKp = evt('treasury_disbursement', { beneficiary_bank_country: 'kp' });
const lowercaseSyria = evt('payment_order', { beneficiary_bank_country: 'sy' });
const award = evt('award', { bidder_count: 3 });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'payment to Iranian bank',
    kind: 'TP',
    subject: tenderSubject({ events: [irPayment] }),
    expect: { matched: true, minStrength: 0.9, mustMentionInRationale: 'ir' },
  },
  {
    name: 'treasury disbursement to DPRK (alt event kind)',
    kind: 'TP',
    subject: tenderSubject({ events: [treasuryToKp] }),
    expect: { matched: true, minStrength: 0.9, mustMentionInRationale: 'kp' },
  },
  {
    name: 'lowercase country code accepted',
    kind: 'edge',
    subject: tenderSubject({ events: [lowercaseSyria] }),
    expect: { matched: true, minStrength: 0.9 },
  },
  {
    name: 'payment to Cameroun bank',
    kind: 'TN',
    subject: tenderSubject({ events: [cmPayment] }),
    expect: { matched: false },
  },
  {
    name: 'no payment event in subject',
    kind: 'TN',
    subject: tenderSubject({ events: [award] }),
    expect: { matched: false, mustMentionInRationale: 'no payment' },
  },
  {
    name: 'mixed events — pattern still keys on the payment kind',
    kind: 'multi',
    subject: tenderSubject({ events: [award, irPayment] }),
    expect: { matched: true, minStrength: 0.9 },
  },
];

runPatternFixtures(pattern, fixtures);
