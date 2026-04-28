import pattern from '../../src/category-a/p-a-005-sole-source-gap.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const SUPPLIER = 'Société Repeat SARL';
const noBidJan = evt(
  'award',
  { supplier_name: SUPPLIER, procurement_method: 'gré à gré' },
  { publishedAt: '2026-01-10T00:00:00Z' },
);
const noBidApr = evt(
  'award',
  { supplier_name: SUPPLIER, procurement_method: 'gré à gré' },
  { publishedAt: '2026-04-10T00:00:00Z' },
);
const noBidJul = evt(
  'award',
  { supplier_name: SUPPLIER, procurement_method: 'marché négocié' },
  { publishedAt: '2026-07-10T00:00:00Z' },
);
const noBidOct = evt(
  'award',
  { supplier_name: SUPPLIER, procurement_method: 'gré à gré' },
  { publishedAt: '2026-10-10T00:00:00Z' },
);
const noBidWayLater = evt(
  'award',
  { supplier_name: SUPPLIER, procurement_method: 'gré à gré' },
  { publishedAt: '2027-08-10T00:00:00Z' }, // > 365d from noBidJan
);
const competitive = evt(
  'award',
  { supplier_name: SUPPLIER, procurement_method: "appel d'offres ouvert" },
  { publishedAt: '2026-03-10T00:00:00Z' },
);
const noBidDifferentSupplier = evt(
  'award',
  { supplier_name: 'Autre SARL', procurement_method: 'gré à gré' },
  { publishedAt: '2026-04-15T00:00:00Z' },
);

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'three no-bid awards same supplier within 12 months',
    kind: 'TP',
    subject: tenderSubject({ events: [noBidJan, noBidApr, noBidJul] }),
    expect: { matched: true, minStrength: 0.5 },
  },
  {
    name: 'four no-bid awards — strength climbs slightly with count',
    kind: 'multi',
    subject: tenderSubject({ events: [noBidJan, noBidApr, noBidJul, noBidOct] }),
    expect: { matched: true, minStrength: 0.6 },
  },
  {
    name: 'three no-bid awards, but third is > 365 days after first',
    kind: 'TN',
    subject: tenderSubject({ events: [noBidJan, noBidApr, noBidWayLater] }),
    expect: { matched: false },
  },
  {
    name: 'two no-bid + one competitive — only 2 no-bid',
    kind: 'TN',
    subject: tenderSubject({ events: [noBidJan, noBidApr, competitive] }),
    expect: { matched: false, mustMentionInRationale: 'fewer than 3 no-bid' },
  },
  {
    name: 'three no-bid but split across two suppliers',
    kind: 'TN',
    subject: tenderSubject({ events: [noBidJan, noBidApr, noBidDifferentSupplier] }),
    expect: { matched: false },
  },
  {
    name: 'two awards total — pattern needs 3+',
    kind: 'edge',
    subject: tenderSubject({ events: [noBidJan, noBidApr] }),
    expect: { matched: false, mustMentionInRationale: 'fewer than 3' },
  },
];

runPatternFixtures(pattern, fixtures);
