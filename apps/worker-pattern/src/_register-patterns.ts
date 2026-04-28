/**
 * Pattern registration barrel — imports every pattern file under
 * @vigil/patterns/src/category-*. Each file calls registerPattern() at module
 * load. Adding a pattern = add an import here (and ship the file).
 *
 * Phase 1: 8 reference patterns committed (one per category). The remaining
 * 35 patterns are scheduled for the follow-up agent.
 */
export function registerAllPatterns(): void {
  /* eslint-disable @typescript-eslint/no-require-imports */
  require('@vigil/patterns/dist/category-a/p-a-001-single-bidder.js');
  require('@vigil/patterns/dist/category-b/p-b-001-shell-company.js');
  require('@vigil/patterns/dist/category-c/p-c-001-price-above-benchmark.js');
  require('@vigil/patterns/dist/category-d/p-d-001-ghost-project.js');
  require('@vigil/patterns/dist/category-e/p-e-001-sanctioned-direct.js');
  require('@vigil/patterns/dist/category-f/p-f-002-director-ring.js');
  require('@vigil/patterns/dist/category-g/p-g-001-backdated-document.js');
  require('@vigil/patterns/dist/category-h/p-h-001-award-before-tender-close.js');
  /* eslint-enable @typescript-eslint/no-require-imports */
}
