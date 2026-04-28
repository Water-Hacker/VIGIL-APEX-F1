import pattern from '../../src/category-a/p-a-008-bid-protest-pattern.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const dismissed1 = evt('audit_observation', { protest_disposition: 'rejeté pour vice de forme' });
const dismissed2 = evt('audit_observation', { protest_disposition: 'plainte rejetée' });
const dismissed3 = evt('audit_observation', { protest_disposition: 'dismissed without review' });
const dismissed4 = evt('audit_observation', { protest_disposition: 'rejeté' });
const upheld = evt('audit_observation', { protest_disposition: 'plainte fondée — réattribution ordonnée' });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'three protests all dismissed',
    kind: 'TP',
    subject: tenderSubject({ events: [dismissed1, dismissed2, dismissed3] }),
    expect: { matched: true, minStrength: 0.65 },
  },
  {
    name: 'four dismissed — strength climbs',
    kind: 'multi',
    subject: tenderSubject({ events: [dismissed1, dismissed2, dismissed3, dismissed4] }),
    expect: { matched: true, minStrength: 0.7 },
  },
  {
    name: 'two protests, one upheld — dismissal ratio 50%',
    kind: 'TN',
    subject: tenderSubject({ events: [dismissed1, upheld] }),
    expect: { matched: false, mustMentionInRationale: 'dismissal ratio' },
  },
  {
    name: 'single protest — pattern needs ≥ 2',
    kind: 'TN',
    subject: tenderSubject({ events: [dismissed1] }),
    expect: { matched: false, mustMentionInRationale: 'fewer than 2' },
  },
  {
    name: 'audit observations with no protest_disposition field',
    kind: 'edge',
    subject: tenderSubject({
      events: [evt('audit_observation', { other_field: 'x' })],
    }),
    expect: { matched: false, mustMentionInRationale: 'fewer than 2' },
  },
  {
    name: 'three protests — two dismissed, one upheld (66% dismissal)',
    kind: 'TN',
    subject: tenderSubject({ events: [dismissed1, dismissed2, upheld] }),
    expect: { matched: false, mustMentionInRationale: 'dismissal ratio' },
  },
];

runPatternFixtures(pattern, fixtures);
