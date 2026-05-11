/**
 * Domain constants — Cameroon-specific and protocol-level.
 *
 * Keep this list small. Values that change per environment go in `.env`,
 * not here.
 */

/* =============================================================================
 * Cameroon administrative regions (ISO-3166-2:CM)
 * ===========================================================================*/

export const CMR_REGIONS = [
  { code: 'AD', nameFr: 'Adamaoua', nameEn: 'Adamawa' },
  { code: 'CE', nameFr: 'Centre', nameEn: 'Centre' },
  { code: 'EN', nameFr: 'Extrême-Nord', nameEn: 'Far North' },
  { code: 'ES', nameFr: 'Est', nameEn: 'East' },
  { code: 'LT', nameFr: 'Littoral', nameEn: 'Littoral' },
  { code: 'NO', nameFr: 'Nord', nameEn: 'North' },
  { code: 'NW', nameFr: 'Nord-Ouest', nameEn: 'North-West' },
  { code: 'OU', nameFr: 'Ouest', nameEn: 'West' },
  { code: 'SU', nameFr: 'Sud', nameEn: 'South' },
  { code: 'SW', nameFr: 'Sud-Ouest', nameEn: 'South-West' },
] as const;

export type CmrRegionCode = (typeof CMR_REGIONS)[number]['code'];
export const CMR_REGION_CODES: ReadonlyArray<CmrRegionCode> = CMR_REGIONS.map((r) => r.code);

/* =============================================================================
 * Pillars (council) — SRD §23.2 / EXEC §08.2
 * ===========================================================================*/

export const PILLARS = ['governance', 'judicial', 'civil_society', 'audit', 'technical'] as const;
export type Pillar = (typeof PILLARS)[number];

/** 5 pillars, 3-of-5 quorum for escalation, 4-of-5 for public release. */
export const QUORUM_SIZE = 5 as const;
export const QUORUM_REQUIRED_ESCALATE = 3 as const;
export const QUORUM_REQUIRED_PUBLIC_RELEASE = 4 as const;

/* =============================================================================
 * Pattern categories — SRD §21.2
 * ===========================================================================*/

export const PATTERN_CATEGORIES = [
  { letter: 'A', name: 'procurement_integrity' },
  { letter: 'B', name: 'beneficial_ownership' },
  { letter: 'C', name: 'price_reasonableness' },
  { letter: 'D', name: 'performance_verification' },
  { letter: 'E', name: 'sanctioned_entity_exposure' },
  { letter: 'F', name: 'network_anomalies' },
  { letter: 'G', name: 'document_integrity' },
  { letter: 'H', name: 'temporal_anomalies' },
] as const;

export type PatternCategoryLetter = (typeof PATTERN_CATEGORIES)[number]['letter'];

/* =============================================================================
 * Bayesian engine thresholds — SRD §19, §28
 * ===========================================================================*/

/** Findings above this posterior enter the escalation queue. SRD §28. */
export const POSTERIOR_ESCALATION_THRESHOLD = 0.85;

/** Operations Room shows findings above this posterior in the live feed. */
export const POSTERIOR_REVIEW_THRESHOLD = 0.55;

/** Counter-evidence (devil's-advocate) runs at this threshold per SRD §19.6. */
export const POSTERIOR_COUNTER_EVIDENCE_THRESHOLD = 0.85;

/* =============================================================================
 * Calibration — SRD §19.5, EXEC §20
 * ===========================================================================*/

export const ECE_TARGET = 0.05;
export const ECE_ALARM = 0.1;
export const CALIBRATION_SEED_FLOOR = 30;
export const CALIBRATION_BIN_DENSITY_TARGET = 50;
export const CALIBRATION_PER_PATTERN_TARGET = 200;

/* =============================================================================
 * Protocol — adapter discipline
 * ===========================================================================*/

/** Default identification when scraping a public source. SRD §13.4.
 *  At runtime, code should call `getAdapterUserAgent()` to honour the
 *  ADAPTER_USER_AGENT env override per OPERATIONS.md. */
export const ADAPTER_DEFAULT_USER_AGENT =
  'VIGIL-APEX/1.0 (anti-corruption pilot, +https://vigilapex.cm/contact)';

/** Resolves the User-Agent to send on adapter requests. Honours the
 *  ADAPTER_USER_AGENT env override; falls back to ADAPTER_DEFAULT_USER_AGENT. */
export function getAdapterUserAgent(): string {
  return process.env.ADAPTER_USER_AGENT?.trim() || ADAPTER_DEFAULT_USER_AGENT;
}

export const ADAPTER_MIN_REQUEST_INTERVAL_MS = 2_000;
export const ADAPTER_DAILY_REQUEST_CAP_DEFAULT = 10_000;
export const ADAPTER_FIRST_CONTACT_DUMP_PATH = '/infra/sites';

/* =============================================================================
 * LLM — SRD §18, MVP §06
 * ===========================================================================*/

/** Temperature ladder per SRD §20.3. */
export const LLM_TEMPERATURE = {
  EXTRACTION: 0.0,
  CLASSIFICATION: 0.2,
  TRANSLATION: 0.4,
  DEVILS_ADVOCATE: 0.6,
} as const;

/**
 * Block-A reconciliation §2.A.4 — pricing moved to `infra/llm/pricing.json`,
 * keyed by EXACT `model_id`. Use `anthropicCostUsd` from `@vigil/llm`
 * (or `getModelPricing(modelId)` for raw access). Keeping this module
 * pricing-free means the rate card cannot drift relative to the
 * model_id that's actually called at runtime.
 */

/* =============================================================================
 * Anchoring — SRD §22, W-11 fix
 * ===========================================================================*/

export const POLYGON_CHAIN_ID_MAINNET = 137;
export const POLYGON_CHAIN_ID_AMOY = 80_002;
export const POLYGON_CHAIN_ID_MUMBAI = 80_001;

export const AUDIT_HASH_ALGO = 'sha256' as const;

/* =============================================================================
 * Vault & Shamir — SRD §17.6
 * ===========================================================================*/

export const VAULT_SHAMIR_TOTAL = 5;
export const VAULT_SHAMIR_THRESHOLD = 3;

/* =============================================================================
 * YubiKey — EXEC §04, HSK rewrite (W-03)
 * ===========================================================================*/

export const YUBIKEY_ESTATE_SIZE = 8;
export const YUBIKEY_DEEP_COLD_BACKUP_ENABLED = true; // W-08 fix

/* =============================================================================
 * Public surfaces
 * ===========================================================================*/

export const SURFACES = {
  OPERATOR: '/findings',
  COUNCIL: '/council',
  PUBLIC_VERIFY: '/verify',
  PUBLIC_LEDGER: '/ledger',
  PUBLIC_TIP: '/tip',
} as const;

/* =============================================================================
 * Finding escalation thresholds — SRD §25 / DECISION-011 (Bayesian engine)
 *
 * SINGLE SOURCE OF TRUTH for the cutoff that gates institutional
 * delivery. Closes FIND-002 from whole-system-audit doc 10 — previously
 * the threshold was 0.85 in the repo default and the 0.95/5-source rule
 * lived only in a documentation comment in `schemas/certainty.ts`.
 *
 * A finding is eligible for CONAC delivery IFF:
 *   posterior >= POSTERIOR_THRESHOLD_CONAC
 *   AND signal_count >= MIN_SIGNAL_COUNT_CONAC
 *
 * Enforcement is layered (defence in depth):
 *   1. `FindingRepo.listEscalationCandidates` default — narrows the
 *      query so operator triage screens already see only candidates
 *      strong enough to bring to council.
 *   2. `worker-governance.handleProposalEscalated` — gate before
 *      publishing dossier.render envelopes after a successful council
 *      vote.
 *   3. `worker-conac-sftp.handle` — final gate before SFTP put().
 *
 * The two values are intentionally re-readable at runtime via the helper
 * `meetsCONACThreshold(finding)` below, so a future change to the
 * cutoff (e.g. tightening to 0.97 after calibration evidence) is a
 * one-file edit.
 * ===========================================================================*/

export const POSTERIOR_THRESHOLD_CONAC = 0.95;
export const MIN_SIGNAL_COUNT_CONAC = 5;

/**
 * Pure predicate over the minimal Finding shape required to make the
 * decision. Accepts partial Finding rows (workers may load lazy
 * projections) and answers true only if BOTH fields exist AND meet
 * their thresholds.
 *
 * Refuse-on-doubt: a missing or non-numeric `posterior` or
 * `signal_count` returns false (fail-closed).
 */
export function meetsCONACThreshold(finding: {
  readonly posterior?: number | null;
  readonly signal_count?: number | null;
}): boolean {
  const p = finding.posterior;
  const c = finding.signal_count;
  if (typeof p !== 'number' || !Number.isFinite(p)) return false;
  if (typeof c !== 'number' || !Number.isFinite(c)) return false;
  return p >= POSTERIOR_THRESHOLD_CONAC && c >= MIN_SIGNAL_COUNT_CONAC;
}
