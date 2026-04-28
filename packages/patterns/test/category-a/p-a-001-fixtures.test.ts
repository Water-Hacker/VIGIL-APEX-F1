import pattern from '../../src/category-a/p-a-001-single-bidder.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const award1Bidder = evt('award', {
  bidder_count: 1,
  procurement_method: 'appel d\'offres ouvert',
  supplier_name: 'Société Alpha SARL',
});
const awardNoBid = evt('award', {
  bidder_count: 1,
  procurement_method: 'gré à gré',
  supplier_name: 'Société Beta SARL',
});
const awardCompetitive = evt('award', {
  bidder_count: 5,
  procurement_method: 'appel d\'offres ouvert',
  supplier_name: 'Société Gamma SARL',
});
const awardEdge = evt('award', {
  bidder_count: 2,
  procurement_method: 'gré à gré',
  supplier_name: 'Société Delta SARL',
});
const priorAward = evt('award', {
  bidder_count: 3,
  procurement_method: 'appel d\'offres ouvert',
  supplier_name: 'Société Alpha SARL',
});

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'lone bidder above threshold',
    kind: 'TP',
    subject: tenderSubject({ events: [award1Bidder] }),
    expect: { matched: true, minStrength: 0.6, mustMentionInRationale: '1 bidder' },
  },
  {
    name: 'no-bid + same supplier as prior award',
    kind: 'TP',
    subject: tenderSubject({ events: [priorAward, awardNoBid, award1Bidder] }),
    expect: { matched: true, minStrength: 0.6 },
  },
  {
    name: 'competitive 5-bidder award',
    kind: 'TN',
    subject: tenderSubject({ events: [awardCompetitive] }),
    expect: { matched: false, maxStrength: 0.4 },
  },
  {
    name: 'no award event in subject',
    kind: 'TN',
    subject: tenderSubject({ events: [] }),
    expect: { matched: false, maxStrength: 0, mustMentionInRationale: 'no award' },
  },
  {
    name: 'no-bid method but 2 bidders — strength bounded by no-bid contribution',
    kind: 'edge',
    subject: tenderSubject({ events: [awardEdge] }),
    expect: { matched: false, maxStrength: 0.45 },
  },
  {
    name: 'lone bidder + no-bid + same-supplier history (multi-signal)',
    kind: 'multi',
    subject: tenderSubject({ events: [priorAward, award1Bidder, awardNoBid] }),
    expect: { matched: true, minStrength: 0.85 },
  },
  {
    name: 'regression: bidder_count missing on payload should not throw',
    kind: 'regression',
    subject: tenderSubject({
      events: [evt('award', { procurement_method: 'appel d\'offres ouvert' })],
    }),
    expect: { matched: false, maxStrength: 0 },
  },
];

runPatternFixtures(pattern, fixtures);
