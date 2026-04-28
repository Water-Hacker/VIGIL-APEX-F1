/**
 * Adapter registration barrel — all 26 adapters.
 *
 * Each file calls `registerAdapter(...)` at module load. The plain
 * side-effect `import` below is enough to trigger that registration; we
 * intentionally do NOT name-import any exports.
 *
 * Reference (full hand-written): armp-main, rccm-search, cour-des-comptes,
 * worldbank-sanctions, opensanctions.
 *
 * The other 21 use `_helpers.ts` + `_sectoral-ministry.ts` factories per
 * BUILD-COMPANION-v2 §41-44 to keep per-source code thin.
 */

// ---- Cameroonian core (procurement + finance) ----
import './armp-main.js';
import './minmap-portal.js';
import './coleps-tenders.js';
import './minfi-portal.js';
import './dgb-budget.js';
import './dgtcfm-treasury.js';
import './dgi-attestations.js';
import './minepat-bip.js';

// ---- Sectoral ministries (largest procurement budgets) ----
import './mintp-public-works.js';
import './minee-energy.js';
import './minsante-health.js';
import './minedub-basic-ed.js';
import './minesec-secondary-ed.js';
import './minhdu-housing.js';

// ---- Registries + audit institutions ----
import './rccm-search.js';
import './cour-des-comptes.js';
import './journal-officiel.js';
import './anif-pep.js';

// ---- International corroboration ----
import './worldbank-sanctions.js';
import './afdb-sanctions.js';
import './eu-sanctions.js';
import './ofac-sdn.js';
import './un-sanctions.js';
import './opensanctions.js';
import './opencorporates.js';
import './occrp-aleph.js';

/**
 * Public entry point — kept for backwards compatibility with the previous
 * registry call site. Importing this module is sufficient on its own; calling
 * `registerAllAdapters()` is now a no-op (modules registered at import time).
 */
export function registerAllAdapters(): void {
  // Intentionally empty — registration occurs via the side-effect imports above.
}
