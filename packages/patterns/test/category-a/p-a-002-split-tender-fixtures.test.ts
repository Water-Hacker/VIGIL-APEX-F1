import pattern from '../../src/category-a/p-a-002-split-tender.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const SUPPLIER = 'Société Slice SARL';
const a1 = evt(
  'award',
  { supplier_name: SUPPLIER, amount_xaf: 35_000_000, procurement_method: 'restreint' },
  { publishedAt: '2026-01-10T00:00:00Z' },
);
const a2 = evt(
  'award',
  { supplier_name: SUPPLIER, amount_xaf: 30_000_000, procurement_method: 'restreint' },
  { publishedAt: '2026-02-15T00:00:00Z' },
);
const a3OutOfWindow = evt(
  'award',
  { supplier_name: SUPPLIER, amount_xaf: 30_000_000, procurement_method: 'restreint' },
  { publishedAt: '2026-08-01T00:00:00Z' }, // > 60 days from a2
);
const aDifferentSupplier = evt(
  'award',
  { supplier_name: 'Autre SARL', amount_xaf: 30_000_000, procurement_method: 'restreint' },
  { publishedAt: '2026-02-20T00:00:00Z' },
);
const aLargeButOpen = evt(
  'award',
  { supplier_name: SUPPLIER, amount_xaf: 30_000_000, procurement_method: 'restreint' },
  { publishedAt: '2026-03-10T00:00:00Z' },
);

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'two awards same supplier within 36 days, sum > 50M, each < 50M',
    kind: 'TP',
    subject: tenderSubject({ events: [a1, a2] }),
    expect: { matched: true, minStrength: 0.5 },
  },
  {
    name: 'three awards form two sliceable pairs',
    kind: 'multi',
    subject: tenderSubject({ events: [a1, a2, aLargeButOpen] }),
    expect: { matched: true, minStrength: 0.5 },
  },
  {
    name: 'second award outside 60-day window',
    kind: 'TN',
    subject: tenderSubject({ events: [a1, a3OutOfWindow] }),
    expect: { matched: false },
  },
  {
    name: 'different suppliers — no slicing relationship',
    kind: 'TN',
    subject: tenderSubject({ events: [a1, aDifferentSupplier] }),
    expect: { matched: false },
  },
  {
    name: 'single award — pattern needs ≥ 2',
    kind: 'TN',
    subject: tenderSubject({ events: [a1] }),
    expect: { matched: false, mustMentionInRationale: 'fewer than 2' },
  },
  {
    name: 'awards present but missing amount_xaf',
    kind: 'edge',
    subject: tenderSubject({
      events: [
        evt('award', { supplier_name: SUPPLIER }, { publishedAt: '2026-01-10T00:00:00Z' }),
        evt('award', { supplier_name: SUPPLIER }, { publishedAt: '2026-02-15T00:00:00Z' }),
      ],
    }),
    expect: { matched: false },
  },
];

runPatternFixtures(pattern, fixtures);
