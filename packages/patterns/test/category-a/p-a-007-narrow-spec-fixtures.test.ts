import pattern from '../../src/category-a/p-a-007-narrow-spec.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const heavilyProprietaryNotice = evt('tender_notice', { spec_proprietary_terms: 5 });
const moderatelyProprietaryNotice = evt('tender_notice', { spec_proprietary_terms: 3 });
const cleanNotice = evt('tender_notice', { spec_proprietary_terms: 0 });
const lowBidderAward = evt('award', { bidder_count: 1 });
const fewBiddersAward = evt('award', { bidder_count: 2 });
const competitiveAward = evt('award', { bidder_count: 6 });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'heavy proprietary terms + 1 bidder accepted',
    kind: 'TP',
    subject: tenderSubject({ events: [heavilyProprietaryNotice, lowBidderAward] }),
    expect: { matched: true, minStrength: 0.7 },
  },
  {
    name: 'moderate proprietary terms + 2 bidders',
    kind: 'TP',
    subject: tenderSubject({ events: [moderatelyProprietaryNotice, fewBiddersAward] }),
    expect: { matched: true, minStrength: 0.55 },
  },
  {
    name: 'clean spec + competitive bid count',
    kind: 'TN',
    subject: tenderSubject({ events: [cleanNotice, competitiveAward] }),
    expect: { matched: false, mustMentionInRationale: 'no narrow-spec signal' },
  },
  {
    name: 'no tender notice — pattern abstains',
    kind: 'TN',
    subject: tenderSubject({ events: [lowBidderAward] }),
    expect: { matched: false, mustMentionInRationale: 'no tender' },
  },
  {
    name: 'heavy proprietary terms but no award yet (pre-award stage)',
    kind: 'edge',
    subject: tenderSubject({ events: [heavilyProprietaryNotice] }),
    expect: { matched: true, minStrength: 0.5 },
  },
  {
    name: 'few proprietary terms but very low bidder count — partial signal',
    kind: 'multi',
    subject: tenderSubject({
      events: [evt('tender_notice', { spec_proprietary_terms: 1 }), lowBidderAward],
    }),
    // proprietaryTerms < 3 → only bidder-count contribution (0.25), below match threshold
    expect: { matched: false, maxStrength: 0.3 },
  },
];

runPatternFixtures(pattern, fixtures);
