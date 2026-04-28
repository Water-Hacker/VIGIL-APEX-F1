/**
 * Adapter registration barrel.
 *
 * Each adapter file has a side-effect call to `registerAdapter(...)`. Importing
 * them here causes registration on module load. New adapters: add an import.
 *
 * Phase 1 reference adapters (5 of 26):
 *   - armp-main         (Cameroon procurement; reference complexity)
 *   - rccm-search       (commercial registry; auth-light)
 *   - cour-des-comptes  (audit reports; PDF-heavy)
 *   - worldbank-sanctions (debarment API; reference for sanctions tier)
 *   - opensanctions     (PEP/sanctions aggregator; reference for API tier)
 *
 * The remaining 21 adapters follow the same patterns and are stubbed in a
 * follow-up agent run; the framework here makes "add the next 21" a copy-and-
 * tune-selectors job, not a re-architect job.
 */

export function registerAllAdapters(): void {
  // Side-effect imports register on load
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./armp-main.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./rccm-search.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./cour-des-comptes.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./worldbank-sanctions.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./opensanctions.js');
}
