import pattern from '../../src/category-g/p-g-002-signature-mismatch.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const lowSimilarity = evt('amendment', { signature_similarity_score: 0.30 });
const moderate = evt('amendment', { signature_similarity_score: 0.60 });
const justUnder = evt('amendment', { signature_similarity_score: 0.84 });
const aboveThreshold = evt('amendment', { signature_similarity_score: 0.92 });
const noScore = evt('amendment', {});
const wrongType = evt('amendment', { signature_similarity_score: 'high' });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'signature similarity 0.30 (highly divergent)',
    kind: 'TP',
    subject: tenderSubject({ events: [lowSimilarity] }),
    expect: { matched: true, minStrength: 0.65 },
  },
  {
    name: 'similarity 0.60 — moderate divergence',
    kind: 'TP',
    subject: tenderSubject({ events: [moderate] }),
    expect: { matched: true, minStrength: 0.35 },
  },
  {
    name: 'similarity 0.84 — just below the 0.85 reference threshold',
    kind: 'edge',
    subject: tenderSubject({ events: [justUnder] }),
    expect: { matched: true, minStrength: 0.1, maxStrength: 0.2 },
  },
  {
    name: 'similarity 0.92 — within tolerance',
    kind: 'TN',
    subject: tenderSubject({ events: [aboveThreshold] }),
    expect: { matched: false, mustMentionInRationale: 'no low-similarity' },
  },
  {
    name: 'no signature_similarity_score on the event',
    kind: 'TN',
    subject: tenderSubject({ events: [noScore] }),
    expect: { matched: false },
  },
  {
    name: 'similarity field is wrong type — pattern skips',
    kind: 'edge',
    subject: tenderSubject({ events: [wrongType] }),
    expect: { matched: false },
  },
];

runPatternFixtures(pattern, fixtures);
