import pattern from '../../src/category-g/p-g-001-backdated-document.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const heavilyBackdated = evt('amendment', {
  effective_date: '2026-01-15',
  document_metadata: { created_date: '2026-04-15T00:00:00Z' }, // 90 days later
});
const slightlyBackdated = evt('amendment', {
  effective_date: '2026-04-01',
  document_metadata: { created_date: '2026-04-12T00:00:00Z' }, // 11 days
});
const notBackdated = evt('amendment', {
  effective_date: '2026-04-15',
  document_metadata: { created_date: '2026-04-10T00:00:00Z' },
});
const noMetadata = evt('amendment', { effective_date: '2026-04-15' });
const malformed = evt('amendment', {
  effective_date: 'not-a-date',
  document_metadata: { created_date: '2026-04-15' },
});

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'document created 90 days after stated effective date',
    kind: 'TP',
    subject: tenderSubject({ events: [heavilyBackdated] }),
    expect: { matched: true, minStrength: 0.95, mustMentionInRationale: 'backdated' },
  },
  {
    name: 'created 11 days late — moderate signal',
    kind: 'edge',
    subject: tenderSubject({ events: [slightlyBackdated] }),
    // 11/30 = 0.366, below match threshold (0.4)
    expect: { matched: false, maxStrength: 0.4 },
  },
  {
    name: 'created before effective date — normal',
    kind: 'TN',
    subject: tenderSubject({ events: [notBackdated] }),
    expect: { matched: false },
  },
  {
    name: 'document lacks metadata',
    kind: 'TN',
    subject: tenderSubject({ events: [noMetadata] }),
    expect: { matched: false },
  },
  {
    name: 'malformed effective_date string — pattern abstains',
    kind: 'edge',
    subject: tenderSubject({ events: [malformed] }),
    expect: { matched: false },
  },
  {
    name: 'mix — one normal + one backdated, takes the worst',
    kind: 'multi',
    subject: tenderSubject({ events: [notBackdated, heavilyBackdated] }),
    expect: { matched: true, minStrength: 0.9 },
  },
];

runPatternFixtures(pattern, fixtures);
