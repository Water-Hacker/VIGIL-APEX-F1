import pattern from '../../src/category-g/p-g-003-metadata-anomaly.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const authorMismatch = evt('amendment', {
  declared_author: 'Direction Générale du Budget',
  document_metadata: { Author: 'Some Random Personal PC' },
});
const unusualSoftware = evt('amendment', {
  declared_author: 'MINFI',
  document_metadata: { Author: 'MINFI', Producer: 'LibreOffice 7.6.4' },
});
const both = evt('amendment', {
  declared_author: 'MINFI',
  document_metadata: { Author: 'Some Random PC', Producer: 'LibreOffice 7.6.4' },
});
const cleanMetadata = evt('amendment', {
  declared_author: 'MINFI',
  document_metadata: { Author: 'MINFI', Producer: 'Adobe PDF Library 23' },
});
const noMetadata = evt('amendment', { declared_author: 'MINFI' });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'declared author differs from PDF metadata Author',
    kind: 'TP',
    subject: tenderSubject({ events: [authorMismatch] }),
    expect: { matched: true, minStrength: 0.5, mustMentionInRationale: 'declared' },
  },
  {
    name: 'metadata Author matches but Producer is LibreOffice (unusual for ministerial doc)',
    kind: 'TP',
    subject: tenderSubject({ events: [unusualSoftware] }),
    expect: { matched: true, minStrength: 0.35, mustMentionInRationale: 'libreoffice' },
  },
  {
    name: 'both author mismatch AND unusual software — strength dominated by mismatch',
    kind: 'multi',
    subject: tenderSubject({ events: [both] }),
    expect: { matched: true, minStrength: 0.5 },
  },
  {
    name: 'metadata consistent with declared author + standard software',
    kind: 'TN',
    subject: tenderSubject({ events: [cleanMetadata] }),
    expect: { matched: false, mustMentionInRationale: 'no metadata anomaly' },
  },
  {
    name: 'no document_metadata on the event',
    kind: 'TN',
    subject: tenderSubject({ events: [noMetadata] }),
    expect: { matched: false },
  },
  {
    name: 'no events at all',
    kind: 'TN',
    subject: tenderSubject({ events: [] }),
    expect: { matched: false },
  },
];

runPatternFixtures(pattern, fixtures);
