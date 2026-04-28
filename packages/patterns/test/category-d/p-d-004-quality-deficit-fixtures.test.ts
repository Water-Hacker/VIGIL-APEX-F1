import pattern from '../../src/category-d/p-d-004-quality-deficit.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const heavyDeficit = evt('audit_observation', {
  quality_deficit: 'road surface 35% below contractual thickness spec',
  severity_score: 0.9,
});
const moderateDeficit = evt('audit_observation', {
  quality_deficit: 'minor surface defects on 12% of length',
  severity_score: 0.4,
});
const remediation = evt('amendment', { purpose: 'remediation works for surface defects' });
const correctifAmendment = evt('amendment', { purpose: 'avenant correctif suite à observation' });
const unrelatedAmendment = evt('amendment', { purpose: 'extension of completion deadline' });
const otherObservation = evt('audit_observation', { other_field: 'x' });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'heavy quality deficit, no remediation',
    kind: 'TP',
    subject: tenderSubject({ events: [heavyDeficit] }),
    expect: { matched: true, minStrength: 0.85 },
  },
  {
    name: 'moderate deficit, no remediation',
    kind: 'TP',
    subject: tenderSubject({ events: [moderateDeficit] }),
    expect: { matched: true, minStrength: 0.6 },
  },
  {
    name: 'deficit + remediation amendment in English',
    kind: 'TN',
    subject: tenderSubject({ events: [heavyDeficit, remediation] }),
    expect: { matched: false, mustMentionInRationale: 'remediation recorded' },
  },
  {
    name: 'deficit + correctif amendment in French',
    kind: 'TN',
    subject: tenderSubject({ events: [heavyDeficit, correctifAmendment] }),
    expect: { matched: false },
  },
  {
    name: 'deficit + unrelated amendment (not remediation)',
    kind: 'TP',
    subject: tenderSubject({ events: [heavyDeficit, unrelatedAmendment] }),
    expect: { matched: true, minStrength: 0.85 },
  },
  {
    name: 'audit observation present but no quality_deficit field',
    kind: 'TN',
    subject: tenderSubject({ events: [otherObservation] }),
    expect: { matched: false, mustMentionInRationale: 'no quality observation' },
  },
];

runPatternFixtures(pattern, fixtures);
