import { adapterGoldenTest, fixtureFor } from './_harness.js';

/**
 * Sweep test for the 21 non-reference adapters (Phase H6).
 *
 * The 5 reference adapters (armp-main, dgi-attestations,
 * cour-des-comptes, opensanctions, worldbank-sanctions) are excluded
 * — they're already covered by their own dedicated tests.
 *
 * As parse shims land per adapter, flip `hasParseShim` to true to
 * exercise the full parse-and-match check.
 */
const NON_REFERENCE_ADAPTERS = [
  'afdb-sanctions',
  'anif-pep',
  'coleps-tenders',
  'dgb-budget',
  'dgtcfm-treasury',
  'eu-sanctions',
  'journal-officiel',
  'minedub-basic-ed',
  'minee-energy',
  'minepat-bip',
  'minesec-secondary-ed',
  'minfi-portal',
  'minhdu-housing',
  'minmap-portal',
  'minsante-health',
  'mintp-public-works',
  'occrp-aleph',
  'ofac-sdn',
  'opencorporates',
  'rccm-search',
  'un-sanctions',
] as const;

for (const sourceId of NON_REFERENCE_ADAPTERS) {
  adapterGoldenTest(fixtureFor(sourceId, false));
}
