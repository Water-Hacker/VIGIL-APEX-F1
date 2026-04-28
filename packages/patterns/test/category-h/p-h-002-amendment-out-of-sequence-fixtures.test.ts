import pattern from '../../src/category-h/p-h-002-amendment-out-of-sequence.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const amendmentApr = evt('amendment', {}, { id: 'aaaaaaaa-1234-4000-a000-000000000001', publishedAt: '2026-04-15T00:00:00Z' });
const amendmentMay = evt('amendment', {}, { id: 'aaaaaaaa-1234-4000-a000-000000000002', publishedAt: '2026-05-15T00:00:00Z' });
const paymentBefore = evt(
  'treasury_disbursement',
  { authorising_amendment_id: 'aaaaaaaa-1234-4000-a000-000000000001' },
  { publishedAt: '2026-03-01T00:00:00Z' }, // 45d before amendment
);
const paymentAfter = evt(
  'payment_order',
  { authorising_amendment_id: 'aaaaaaaa-1234-4000-a000-000000000001' },
  { publishedAt: '2026-04-25T00:00:00Z' },
);
const paymentNoAuthLink = evt(
  'payment_order',
  { /* no authorising_amendment_id */ },
  { publishedAt: '2026-03-01T00:00:00Z' },
);
const paymentBeforeAm2 = evt(
  'payment_order',
  { authorising_amendment_id: 'aaaaaaaa-1234-4000-a000-000000000002' },
  { publishedAt: '2026-04-20T00:00:00Z' }, // 25d before amendmentMay
);

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'payment 45d before its authorising amendment',
    kind: 'TP',
    subject: tenderSubject({ events: [amendmentApr, paymentBefore] }),
    expect: { matched: true, minStrength: 0.95 },
  },
  {
    name: 'payment after its authorising amendment — normal',
    kind: 'TN',
    subject: tenderSubject({ events: [amendmentApr, paymentAfter] }),
    expect: { matched: false, mustMentionInRationale: 'no out-of-sequence' },
  },
  {
    name: 'payment without authorising_amendment_id — pattern abstains',
    kind: 'TN',
    subject: tenderSubject({ events: [amendmentApr, paymentNoAuthLink] }),
    expect: { matched: false },
  },
  {
    name: 'payment 25d before second amendment — moderate strength',
    kind: 'multi',
    subject: tenderSubject({ events: [amendmentApr, amendmentMay, paymentBeforeAm2, paymentAfter] }),
    expect: { matched: true, minStrength: 0.75 },
  },
  {
    name: 'no amendments at all',
    kind: 'TN',
    subject: tenderSubject({ events: [paymentBefore] }),
    expect: { matched: false, mustMentionInRationale: 'missing events' },
  },
  {
    name: 'no payments at all',
    kind: 'TN',
    subject: tenderSubject({ events: [amendmentApr] }),
    expect: { matched: false, mustMentionInRationale: 'missing events' },
  },
];

runPatternFixtures(pattern, fixtures);
