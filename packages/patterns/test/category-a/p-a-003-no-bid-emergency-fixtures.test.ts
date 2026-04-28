import pattern from '../../src/category-a/p-a-003-no-bid-emergency.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const noBidAward = evt('award', {
  procurement_method: 'gré à gré',
  supplier_name: 'Société Sole-Source SARL',
});
const competitiveAward = evt('award', {
  procurement_method: 'appel d\'offres ouvert',
  supplier_name: 'Société Compete SARL',
});
const negotiatedAward = evt('award', {
  procurement_method: 'marché négocié',
  supplier_name: 'Société Negoce SARL',
});
const emergencyDecree = evt('gazette_decree', {
  emergency: true,
  scope: 'health-emergency-cholera-2026',
});
const ordinaryDecree = evt('gazette_decree', { emergency: false });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'gré à gré without any covering decree',
    kind: 'TP',
    subject: tenderSubject({ events: [noBidAward] }),
    expect: { matched: true, minStrength: 0.6 },
  },
  {
    name: 'marché négocié without emergency decree',
    kind: 'TP',
    subject: tenderSubject({ events: [negotiatedAward] }),
    expect: { matched: true, minStrength: 0.6 },
  },
  {
    name: 'no-bid covered by an emergency decree on the subject — defers',
    kind: 'TN',
    subject: tenderSubject({ events: [noBidAward, emergencyDecree] }),
    expect: { matched: false, mustMentionInRationale: 'emergency' },
  },
  {
    name: 'competitive award — different pattern (P-A-001) territory',
    kind: 'TN',
    subject: tenderSubject({ events: [competitiveAward] }),
    expect: { matched: false, mustMentionInRationale: 'competitive' },
  },
  {
    name: 'no award event',
    kind: 'TN',
    subject: tenderSubject({ events: [] }),
    expect: { matched: false },
  },
  {
    name: 'no-bid + only an ordinary (non-emergency) decree present',
    kind: 'edge',
    subject: tenderSubject({ events: [noBidAward, ordinaryDecree] }),
    expect: { matched: true, minStrength: 0.6 },
  },
];

runPatternFixtures(pattern, fixtures);
