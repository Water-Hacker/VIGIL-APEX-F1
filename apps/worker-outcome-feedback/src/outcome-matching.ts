/**
 * Pure outcome-matching logic — testable without database or HTTP.
 *
 * Closes Layer-7 of FRONTIER-AUDIT: the platform must measure
 * whether delivered dossiers produce institutional action. Without
 * this, the system optimises for "delivered" rather than "acted on,"
 * which is precisely the wrong metric for the parent at 3am.
 *
 * Inputs to the matcher:
 *   - A delivered dossier: {dossier_ref, recipient_body, delivered_at,
 *                            primary_entity_id, primary_entity_name,
 *                            ubo_names[], pattern_categories[]}
 *   - An external operational signal: {signal_id, source, kind, date,
 *                                       text, entities_mentioned[]}
 *
 * Sources of operational signals (in priority order):
 *
 *   1. CONAC press releases (procurement-fraud announcements)
 *   2. Cour Suprême judgments (criminal + administrative)
 *   3. ARMP debarment listings (procurement debarments)
 *   4. Tribunal de Première Instance public court rolls
 *   5. ANIF annual reports + bulletins
 *   6. MINFI quarterly disbursement-clawback bulletins
 *
 * The matcher produces an `OutcomeMatch` with a score 0..1 indicating
 * confidence that the signal refers to the dossier. The worker shell
 * persists high-confidence matches (>= 0.7) as `dossier_outcome`
 * rows; below-confidence matches are surfaced to operators for
 * human curation.
 *
 * Match dimensions:
 *
 *   - **Entity overlap**: primary entity name, RCCM number, NIU, UBO
 *     names. Levenshtein-normalised + token-set Jaccard.
 *   - **Temporal proximity**: signal must post-date dossier delivery
 *     by between 7 days and 36 months. Outside that window, hard 0.
 *   - **Body-mention**: signal source matches dossier recipient body
 *     (e.g., CONAC press release matching a CONAC-delivered dossier)
 *     boosts score.
 *   - **Pattern-category match**: signal text mentions concepts
 *     consistent with the dossier's pattern categories.
 *
 * No LLM call needed for the match (per audit doctrine, deterministic
 * where possible). An optional secondary LLM disambiguation pass for
 * borderline cases is exposed but off by default.
 */

export interface DeliveredDossierSummary {
  readonly dossier_ref: string;
  readonly recipient_body: 'CONAC' | 'COUR_DES_COMPTES' | 'MINFI' | 'ANIF' | 'CDC' | 'OTHER';
  readonly delivered_at: string; // ISO-8601
  readonly primary_entity_id: string;
  readonly primary_entity_name: string;
  readonly primary_entity_aliases: ReadonlyArray<string>;
  readonly rccm?: string;
  readonly niu?: string;
  readonly ubo_names: ReadonlyArray<string>;
  readonly pattern_categories: ReadonlyArray<string>;
}

export type OperationalSignalSource =
  | 'conac_press'
  | 'cour_supreme'
  | 'armp_debarment'
  | 'tpi_court_roll'
  | 'anif_bulletin'
  | 'minfi_clawback';

export interface OperationalSignal {
  readonly signal_id: string;
  readonly source: OperationalSignalSource;
  readonly kind:
    | 'investigation_opened'
    | 'charges_filed'
    | 'conviction'
    | 'acquittal'
    | 'debarment'
    | 'fine_assessed'
    | 'asset_freeze'
    | 'asset_clawback'
    | 'case_closed_without_action';
  readonly date: string; // ISO-8601
  readonly text: string;
  readonly entities_mentioned: ReadonlyArray<string>;
  readonly amount_xaf?: number;
}

export interface OutcomeMatch {
  readonly dossier_ref: string;
  readonly signal_id: string;
  readonly score: number; // 0..1
  readonly dimensions: {
    readonly entity_overlap: number;
    readonly temporal_proximity: number;
    readonly body_alignment: number;
    readonly category_alignment: number;
  };
  readonly rationale: string;
  readonly is_high_confidence: boolean;
}

const HIGH_CONFIDENCE_THRESHOLD = 0.7;

// Source → recipient body alignment.
const SOURCE_BODY_ALIGNMENT: Readonly<Record<OperationalSignalSource, ReadonlyArray<string>>> = {
  conac_press: ['CONAC'],
  cour_supreme: ['CONAC', 'COUR_DES_COMPTES', 'ANIF'],
  armp_debarment: ['CONAC'],
  tpi_court_roll: ['CONAC', 'COUR_DES_COMPTES', 'ANIF'],
  anif_bulletin: ['ANIF'],
  minfi_clawback: ['MINFI', 'COUR_DES_COMPTES'],
};

const CATEGORY_KEYWORD_HINTS: Readonly<Record<string, ReadonlyArray<string>>> = {
  A: [
    'marché',
    'soumissionnaire',
    'appel',
    'attribution',
    'procurement',
    'tender',
    'single bidder',
  ],
  B: ['société écran', 'shell', 'ubo', 'bénéficiaire effectif', 'nominee'],
  C: ['surfacturation', 'prix', 'inflated', 'overpricing', 'unit price'],
  D: ['inachevé', 'fantôme', 'ghost project', 'incomplete'],
  E: ['sanction', 'pep', 'sanctioned'],
  F: ['blanchiment', 'laundering', 'round-trip', 'hub-and-spoke'],
  G: ['document', 'signature', 'antidaté', 'backdated'],
  H: ['avant clôture', 'before close', 'séquence'],
  I: ['détournement', 'embezzlement', 'misappropriation'],
  J: ['états financiers', 'financial statement', 'comptable'],
  K: ["surfacturation à l'importation", 'trade-based', 'misclassification'],
  L: ['pot-de-vin', 'bribery', 'kickback'],
  M: ['entente', 'collusion', 'cartel'],
  N: ['offshore', 'paradis fiscal', 'pandora'],
  O: ['mine', 'pétrole', 'concession', 'mining', 'oil'],
  P: ['patrimoine inexpliqué', 'unexplained wealth', 'enrichissement illicite'],
};

/**
 * Token-set Jaccard for fuzzy entity-name match. Lowercases,
 * removes punctuation, tokenises on whitespace, drops common
 * legal-form tokens (SARL, SA, EURL, etc.).
 */
function nameTokens(s: string): Set<string> {
  const stopwords = new Set([
    'sarl',
    'sa',
    'eurl',
    'sas',
    'sasu',
    'sci',
    'spa',
    'gmbh',
    'ltd',
    'inc',
    'corp',
    'cie',
    'compagnie',
    'company',
    'co',
    'group',
    'groupe',
    'holdings',
    'partners',
    'the',
    'le',
    'la',
    'les',
    'de',
    'du',
    'des',
    'et',
    'and',
  ]);
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !stopwords.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = new Set<string>();
  for (const x of a) if (b.has(x)) intersection.add(x);
  const union = new Set<string>([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function entityOverlapScore(dossier: DeliveredDossierSummary, signal: OperationalSignal): number {
  // Exact RCCM / NIU match in the signal text is a slam dunk, regardless of
  // whether the signal source extracted any named entities — some sources
  // (court rolls, debarment lists) only emit a registry id.
  if (dossier.rccm && signal.text.toUpperCase().includes(dossier.rccm.toUpperCase())) return 1.0;
  if (dossier.niu && signal.text.toUpperCase().includes(dossier.niu.toUpperCase())) return 1.0;

  const dossierNames = [
    dossier.primary_entity_name,
    ...dossier.primary_entity_aliases,
    ...dossier.ubo_names,
  ];
  if (dossierNames.length === 0 || signal.entities_mentioned.length === 0) return 0;

  let best = 0;
  for (const dName of dossierNames) {
    const dTokens = nameTokens(dName);
    if (dTokens.size === 0) continue;
    for (const sName of signal.entities_mentioned) {
      const score = jaccard(dTokens, nameTokens(sName));
      if (score > best) best = score;
    }
  }
  return best;
}

function temporalProximityScore(
  dossier: DeliveredDossierSummary,
  signal: OperationalSignal,
): number {
  const d = Date.parse(dossier.delivered_at);
  const s = Date.parse(signal.date);
  if (!Number.isFinite(d) || !Number.isFinite(s)) return 0;
  const deltaDays = (s - d) / 86_400_000;
  if (deltaDays < 7) return 0; // signal too early — not caused by our dossier
  if (deltaDays > 1080) return 0; // > 36 months — too far to plausibly attribute
  // Score: peaks at ~90 days, decays toward 36 months.
  if (deltaDays <= 90) return 0.6 + (deltaDays / 90) * 0.4; // 0.6..1.0
  const decay = 1 - (deltaDays - 90) / (1080 - 90);
  return 0.4 * Math.max(0, decay);
}

function bodyAlignmentScore(dossier: DeliveredDossierSummary, signal: OperationalSignal): number {
  const aligned = SOURCE_BODY_ALIGNMENT[signal.source] ?? [];
  return aligned.includes(dossier.recipient_body) ? 1 : 0.2;
}

function categoryAlignmentScore(
  dossier: DeliveredDossierSummary,
  signal: OperationalSignal,
): number {
  if (dossier.pattern_categories.length === 0) return 0.5; // neutral
  const text = signal.text.toLowerCase();
  let matches = 0;
  for (const cat of dossier.pattern_categories) {
    const hints = CATEGORY_KEYWORD_HINTS[cat] ?? [];
    if (hints.some((h) => text.includes(h.toLowerCase()))) matches += 1;
  }
  return Math.min(1, matches / dossier.pattern_categories.length);
}

export function matchOutcome(
  dossier: DeliveredDossierSummary,
  signal: OperationalSignal,
): OutcomeMatch {
  const dims = {
    entity_overlap: entityOverlapScore(dossier, signal),
    temporal_proximity: temporalProximityScore(dossier, signal),
    body_alignment: bodyAlignmentScore(dossier, signal),
    category_alignment: categoryAlignmentScore(dossier, signal),
  };

  // Weighted average. Entity overlap is the most important dimension —
  // a high entity-overlap with everything else weak is still a probable
  // match. Conversely, perfect temporal + body alignment with zero
  // entity overlap is not a match.
  const score =
    0.55 * dims.entity_overlap +
    0.2 * dims.temporal_proximity +
    0.1 * dims.body_alignment +
    0.15 * dims.category_alignment;

  // Hard floors — if either entity_overlap is below 0.30 OR the signal is
  // outside the temporal window (which makes temporal_proximity exactly 0),
  // the match cannot be high-confidence regardless of other dimensions.
  // A signal that pre-dates the dossier or arrives 36 months later cannot
  // plausibly have been caused by the dossier; the body-and-category
  // dimensions are insufficient on their own.
  const is_high_confidence =
    dims.entity_overlap >= 0.3 && dims.temporal_proximity > 0 && score >= HIGH_CONFIDENCE_THRESHOLD;

  const rationale =
    `entity=${dims.entity_overlap.toFixed(2)}, ` +
    `temporal=${dims.temporal_proximity.toFixed(2)}, ` +
    `body=${dims.body_alignment.toFixed(2)}, ` +
    `category=${dims.category_alignment.toFixed(2)}, ` +
    `weighted=${score.toFixed(2)}`;

  return {
    dossier_ref: dossier.dossier_ref,
    signal_id: signal.signal_id,
    score,
    dimensions: dims,
    rationale,
    is_high_confidence,
  };
}

/**
 * Given one signal and many candidate dossiers, return the best
 * matches above the candidate threshold. Sorted by score desc.
 */
export function matchSignalAgainstDossiers(
  signal: OperationalSignal,
  candidates: ReadonlyArray<DeliveredDossierSummary>,
  candidateThreshold = 0.35,
): ReadonlyArray<OutcomeMatch> {
  return candidates
    .map((d) => matchOutcome(d, signal))
    .filter((m) => m.score >= candidateThreshold)
    .sort((a, b) => b.score - a.score);
}
