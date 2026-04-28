import pattern from '../../src/category-d/p-d-003-site-mismatch.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

// Yaoundé centre roughly: 3.8480, 11.5021
const award = evt('award', {
  gps: { lat: 3.8480, lon: 11.5021 },
});
// Same coordinates ± a few meters
const satOnSite = evt('satellite_imagery', {
  activity_centroid: { lat: 3.8482, lon: 11.5023 },
});
// ~600 m off (just past threshold).
const satNearby = evt('satellite_imagery', {
  activity_centroid: { lat: 3.8536, lon: 11.5021 },
});
// ~5 km off — strong site mismatch.
const satFar = evt('satellite_imagery', {
  activity_centroid: { lat: 3.8930, lon: 11.5021 },
});
const satNoCentroid = evt('satellite_imagery', {});
const awardNoGps = evt('award', {});

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'satellite activity 5 km from declared GPS',
    kind: 'TP',
    subject: tenderSubject({ events: [award, satFar] }),
    expect: { matched: true, minStrength: 0.9, mustMentionInRationale: 'm from declared' },
  },
  {
    name: '~600 m off — just past threshold',
    kind: 'edge',
    subject: tenderSubject({ events: [award, satNearby] }),
    expect: { matched: true, minStrength: 0.05 },
  },
  {
    name: 'activity within 50 m of declared site',
    kind: 'TN',
    subject: tenderSubject({ events: [award, satOnSite] }),
    expect: { matched: false, mustMentionInRationale: 'distance=' },
  },
  {
    name: 'satellite event missing activity_centroid',
    kind: 'TN',
    subject: tenderSubject({ events: [award, satNoCentroid] }),
    expect: { matched: false, mustMentionInRationale: 'missing GPS' },
  },
  {
    name: 'award has no declared GPS',
    kind: 'TN',
    subject: tenderSubject({ events: [awardNoGps, satFar] }),
    expect: { matched: false, mustMentionInRationale: 'missing GPS' },
  },
  {
    name: 'no satellite imagery at all',
    kind: 'TN',
    subject: tenderSubject({ events: [award] }),
    expect: { matched: false, mustMentionInRationale: 'missing award or satellite' },
  },
];

runPatternFixtures(pattern, fixtures);
