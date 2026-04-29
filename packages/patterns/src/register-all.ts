/**
 * Side-effect barrel — importing this module registers every pattern in
 * `PatternRegistry`. Used by worker-pattern at boot AND by tests that
 * exercise the registry without going through the worker's CommonJS
 * resolution path.
 *
 * Adding a pattern: add the corresponding side-effect import below.
 */
import './category-a/p-a-001-single-bidder.js';
import './category-a/p-a-002-split-tender.js';
import './category-a/p-a-003-no-bid-emergency.js';
import './category-a/p-a-004-late-amendment.js';
import './category-a/p-a-005-sole-source-gap.js';
import './category-a/p-a-006-uneven-bid-spread.js';
import './category-a/p-a-007-narrow-spec.js';
import './category-a/p-a-008-bid-protest-pattern.js';
import './category-a/p-a-009-debarment-bypass.js';
import './category-b/p-b-001-shell-company.js';
import './category-b/p-b-002-nominee-director.js';
import './category-b/p-b-003-jurisdiction-shopping.js';
import './category-b/p-b-004-rapid-incorporation.js';
import './category-b/p-b-005-co-incorporated-cluster.js';
import './category-b/p-b-006-ubo-mismatch.js';
import './category-b/p-b-007-pep-link.js';
import './category-c/p-c-001-price-above-benchmark.js';
import './category-c/p-c-002-unit-price-anomaly.js';
import './category-c/p-c-003-quantity-mismatch.js';
import './category-c/p-c-004-inflation-divergence.js';
import './category-c/p-c-005-currency-arbitrage.js';
import './category-c/p-c-006-escalation-clause-abuse.js';
import './category-d/p-d-001-ghost-project.js';
import './category-d/p-d-002-incomplete-construction.js';
import './category-d/p-d-003-site-mismatch.js';
import './category-d/p-d-004-quality-deficit.js';
import './category-d/p-d-005-progress-fabrication.js';
import './category-e/p-e-001-sanctioned-direct.js';
import './category-e/p-e-002-sanctioned-related.js';
import './category-e/p-e-003-sanctioned-jurisdiction-payment.js';
import './category-e/p-e-004-transaction-pep-sanctioned.js';
import './category-f/p-f-001-round-trip-payment.js';
import './category-f/p-f-002-director-ring.js';
import './category-f/p-f-003-supplier-circular-flow.js';
import './category-f/p-f-004-hub-and-spoke.js';
import './category-f/p-f-005-dense-bidder-network.js';
import './category-g/p-g-001-backdated-document.js';
import './category-g/p-g-002-signature-mismatch.js';
import './category-g/p-g-003-metadata-anomaly.js';
import './category-g/p-g-004-font-anomaly.js';
import './category-h/p-h-001-award-before-tender-close.js';
import './category-h/p-h-002-amendment-out-of-sequence.js';
import './category-h/p-h-003-holiday-publication-burst.js';
