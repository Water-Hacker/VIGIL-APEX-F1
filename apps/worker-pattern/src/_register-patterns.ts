/**
 * Pattern registration barrel — all 43 patterns across 8 categories.
 *
 * Each file under `@vigil/patterns/src/category-*` calls `registerPattern(...)`
 * at module load. Side-effect imports below trigger registration.
 *
 * Adding a pattern = (1) write the file, (2) add the import here.
 */

// ---- Category A — procurement integrity (9) ----
import '@vigil/patterns/dist/category-a/p-a-001-single-bidder.js';
import '@vigil/patterns/dist/category-a/p-a-002-split-tender.js';
import '@vigil/patterns/dist/category-a/p-a-003-no-bid-emergency.js';
import '@vigil/patterns/dist/category-a/p-a-004-late-amendment.js';
import '@vigil/patterns/dist/category-a/p-a-005-sole-source-gap.js';
import '@vigil/patterns/dist/category-a/p-a-006-uneven-bid-spread.js';
import '@vigil/patterns/dist/category-a/p-a-007-narrow-spec.js';
import '@vigil/patterns/dist/category-a/p-a-008-bid-protest-pattern.js';
import '@vigil/patterns/dist/category-a/p-a-009-debarment-bypass.js';

// ---- Category B — beneficial-ownership concealment (7) ----
import '@vigil/patterns/dist/category-b/p-b-001-shell-company.js';
import '@vigil/patterns/dist/category-b/p-b-002-nominee-director.js';
import '@vigil/patterns/dist/category-b/p-b-003-jurisdiction-shopping.js';
import '@vigil/patterns/dist/category-b/p-b-004-rapid-incorporation.js';
import '@vigil/patterns/dist/category-b/p-b-005-co-incorporated-cluster.js';
import '@vigil/patterns/dist/category-b/p-b-006-ubo-mismatch.js';
import '@vigil/patterns/dist/category-b/p-b-007-pep-link.js';

// ---- Category C — price-reasonableness (6) ----
import '@vigil/patterns/dist/category-c/p-c-001-price-above-benchmark.js';
import '@vigil/patterns/dist/category-c/p-c-002-unit-price-anomaly.js';
import '@vigil/patterns/dist/category-c/p-c-003-quantity-mismatch.js';
import '@vigil/patterns/dist/category-c/p-c-004-inflation-divergence.js';
import '@vigil/patterns/dist/category-c/p-c-005-currency-arbitrage.js';
import '@vigil/patterns/dist/category-c/p-c-006-escalation-clause-abuse.js';

// ---- Category D — performance verification (5) ----
import '@vigil/patterns/dist/category-d/p-d-001-ghost-project.js';
import '@vigil/patterns/dist/category-d/p-d-002-incomplete-construction.js';
import '@vigil/patterns/dist/category-d/p-d-003-site-mismatch.js';
import '@vigil/patterns/dist/category-d/p-d-004-quality-deficit.js';
import '@vigil/patterns/dist/category-d/p-d-005-progress-fabrication.js';

// ---- Category E — sanctioned-entity exposure (4) ----
import '@vigil/patterns/dist/category-e/p-e-001-sanctioned-direct.js';
import '@vigil/patterns/dist/category-e/p-e-002-sanctioned-related.js';
import '@vigil/patterns/dist/category-e/p-e-003-sanctioned-jurisdiction-payment.js';
import '@vigil/patterns/dist/category-e/p-e-004-transaction-pep-sanctioned.js';

// ---- Category F — network anomalies (5) ----
import '@vigil/patterns/dist/category-f/p-f-001-round-trip-payment.js';
import '@vigil/patterns/dist/category-f/p-f-002-director-ring.js';
import '@vigil/patterns/dist/category-f/p-f-003-supplier-circular-flow.js';
import '@vigil/patterns/dist/category-f/p-f-004-hub-and-spoke.js';
import '@vigil/patterns/dist/category-f/p-f-005-dense-bidder-network.js';

// ---- Category G — document integrity (4) ----
import '@vigil/patterns/dist/category-g/p-g-001-backdated-document.js';
import '@vigil/patterns/dist/category-g/p-g-002-signature-mismatch.js';
import '@vigil/patterns/dist/category-g/p-g-003-metadata-anomaly.js';
import '@vigil/patterns/dist/category-g/p-g-004-font-anomaly.js';

// ---- Category H — temporal anomalies (3) ----
import '@vigil/patterns/dist/category-h/p-h-001-award-before-tender-close.js';
import '@vigil/patterns/dist/category-h/p-h-002-amendment-out-of-sequence.js';
import '@vigil/patterns/dist/category-h/p-h-003-holiday-publication-burst.js';

/**
 * Public entry point — kept for backwards compatibility with the previous
 * registry call site. Importing this module is sufficient on its own;
 * `registerAllPatterns()` is now a no-op (modules registered at import time).
 *
 * Total: 43 patterns / 8 categories per BUILD-COMPANION-v2 §45-52.
 */
export function registerAllPatterns(): void {
  // Intentionally empty — registration occurs via the side-effect imports above.
}
