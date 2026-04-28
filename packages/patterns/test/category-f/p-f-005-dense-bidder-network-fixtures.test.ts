import pattern from '../../src/category-f/p-f-005-dense-bidder-network.js';

import { evt, runPatternFixtures, tenderSubject, type PatternFixture } from '../_harness.js';

const dense = evt('award', { bidder_graph_density: 0.85 });
const moderate = evt('award', { bidder_graph_density: 0.70 });
const justUnder = evt('award', { bidder_graph_density: 0.59 });
const sparse = evt('award', { bidder_graph_density: 0.20 });
const tender = evt('tender_notice', { bidder_graph_density: 0.85 });

const fixtures: ReadonlyArray<PatternFixture> = [
  {
    name: 'bidder graph density 0.85',
    kind: 'TP',
    subject: tenderSubject({ events: [dense] }),
    expect: { matched: true, minStrength: 0.6, mustMentionInRationale: 'density' },
  },
  {
    name: 'density 0.70',
    kind: 'TP',
    subject: tenderSubject({ events: [moderate] }),
    expect: { matched: true, minStrength: 0.2 },
  },
  {
    name: 'density 0.59 — just under threshold',
    kind: 'TN',
    subject: tenderSubject({ events: [justUnder] }),
    expect: { matched: false, mustMentionInRationale: 'density=' },
  },
  {
    name: 'sparse network',
    kind: 'TN',
    subject: tenderSubject({ events: [sparse] }),
    expect: { matched: false },
  },
  {
    name: 'no award event',
    kind: 'TN',
    subject: tenderSubject({ events: [] }),
    expect: { matched: false, mustMentionInRationale: 'no award' },
  },
  {
    name: 'density only on tender_notice (not award)',
    kind: 'edge',
    subject: tenderSubject({ events: [tender] }),
    expect: { matched: false, mustMentionInRationale: 'no award' },
  },
];

runPatternFixtures(pattern, fixtures);
