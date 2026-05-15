import type { PatternCategoryLetter } from '../constants.js';
import type { Severity } from '../schemas/common.js';
import type { RecipientBody } from '../schemas/dossier.js';

/**
 * Pattern-category → recipient-body routing.
 *
 * Per TRUTH §G + DECISION-010, the default destination of an escalated finding
 * is computed from its primary pattern category and severity. This function
 * is pure and side-effect-free; it is called by:
 *
 *   - worker-score, when the finding crosses POSTERIOR_REVIEW_THRESHOLD,
 *     to populate `finding.recommended_recipient_body` for the operator UI.
 *   - worker-governance, when a proposal escalates, to default
 *     `dossier.recipient_body_name` if no operator override has been recorded.
 *
 * The mapping reflects each Cameroonian institution's mandate:
 *
 *   A — procurement integrity      → CONAC (primary anti-corruption commission)
 *   B — beneficial ownership       → CONAC (procurement-rigging surrogate)
 *                                    or COUR_DES_COMPTES if amount >= 1B XAF
 *   C — price reasonableness       → CONAC
 *   D — performance verification   → COUR_DES_COMPTES (audit-court mandate
 *                                    over executed-but-unverified spend)
 *   E — sanctioned entity exposure → ANIF (Agence Nationale d'Investigation
 *                                    Financière, AML/CTF designate per Loi
 *                                    N° 2010/010)
 *   F — network anomalies          → CONAC
 *   G — document integrity         → COUR_DES_COMPTES (administrative-evidence
 *                                    chain of custody)
 *   H — temporal anomalies         → CONAC
 *
 * Severity escalators:
 *   critical-severity findings in any procurement-adjacent category (A, B, C, F)
 *   route to COUR_DES_COMPTES (higher-judicial-weight surrogate) regardless of
 *   the per-letter default; the architect can override.
 *
 *   pre-disbursement-flag findings (typically B or H with the
 *   `pre_disbursement_advisory` metadata flag) route to MINFI per SRD §26 —
 *   the risk-scoring API integration that informs the disbursement decision.
 *
 * The "OTHER" recipient is the explicit escape hatch when none of the four
 * primary bodies applies (e.g. cross-border findings routed to a CEMAC
 * counterpart). The operator must set that manually via the dashboard.
 */

export interface RecommendRecipientBodyInput {
  readonly patternCategory: PatternCategoryLetter;
  readonly severity: Severity;
  readonly preDisbursementFlag?: boolean;
}

export function recommendRecipientBody(input: RecommendRecipientBodyInput): RecipientBody {
  if (input.preDisbursementFlag === true) return 'MINFI';

  const procurementAdjacent: ReadonlySet<PatternCategoryLetter> = new Set(['A', 'B', 'C', 'F']);
  if (procurementAdjacent.has(input.patternCategory) && input.severity === 'critical') {
    return 'COUR_DES_COMPTES';
  }

  switch (input.patternCategory) {
    case 'A':
      return 'CONAC';
    case 'B':
      return 'CONAC';
    case 'C':
      return 'CONAC';
    case 'D':
      return 'COUR_DES_COMPTES';
    case 'E':
      return 'ANIF';
    case 'F':
      return 'CONAC';
    case 'G':
      return 'COUR_DES_COMPTES';
    case 'H':
      return 'CONAC';
    // 2026-05-14 — FRONTIER-AUDIT E1.1 categories I–P
    case 'I':
      return 'COUR_DES_COMPTES'; // ACFE asset misappropriation → audit court
    case 'J':
      return 'COUR_DES_COMPTES'; // ACFE financial-statement fraud → audit court
    case 'K':
      return 'ANIF'; // FATF trade-based ML → AML/CFT body
    case 'L':
      return 'CONAC'; // OECD foreign bribery → anti-corruption commission
    case 'M':
      return 'CONAC'; // WB INT procurement collusion → anti-corruption commission
    case 'N':
      return 'ANIF'; // Beneficial-ownership layering → AML/CFT body
    case 'O':
      return 'COUR_DES_COMPTES'; // Extractive sector → audit court
    case 'P':
      return 'ANIF'; // Post-award personal enrichment (Loi 2018/011 patrimoine inexpliqué) → ANIF
  }
}

export interface PatternCategoryFromIdResult {
  readonly category: PatternCategoryLetter;
  readonly index: number; // numeric portion, e.g. 1 for P-A-001
}

// Extended 2026-05-14 per FRONTIER-AUDIT E1.1 — categories I-P added.
const PATTERN_ID_RE = /^P-([A-P])-(\d{3})$/;

/** Extracts category letter + numeric index from a pattern_id like "P-A-001". */
export function parsePatternId(patternId: string): PatternCategoryFromIdResult | null {
  const m = PATTERN_ID_RE.exec(patternId);
  if (!m) return null;
  return {
    category: m[1] as PatternCategoryLetter,
    index: Number.parseInt(m[2]!, 10),
  };
}

/**
 * Bilingual cover-page header for a dossier. Used by the renderer.
 * Returns `{fr, en}` honouring the formal register (Veuillez agréer…).
 */
export function recipientBodyHeaders(body: RecipientBody): {
  fr: { addressee: string; title: string };
  en: { addressee: string; title: string };
} {
  switch (body) {
    case 'CONAC':
      return {
        fr: {
          addressee:
            "À l'attention de Monsieur le Président de la Commission Nationale Anti-Corruption",
          title: 'Saisine — Constatation et éléments de preuve',
        },
        en: {
          addressee: 'To the President of the National Anti-Corruption Commission',
          title: 'Referral — Finding and evidentiary record',
        },
      };
    case 'COUR_DES_COMPTES':
      return {
        fr: {
          addressee:
            'À Monsieur le Premier Président de la Cour des Comptes de la République du Cameroun',
          title: "Référé — Anomalies d'exécution budgétaire et éléments de preuve",
        },
        en: {
          addressee: 'To the First President of the Court of Auditors of the Republic of Cameroon',
          title: 'Référé — Budget-execution anomalies and evidentiary record',
        },
      };
    case 'MINFI':
      return {
        fr: {
          addressee: "À l'attention du Directeur Général du Budget — MINFI",
          title: 'Avis pré-décaissement — Score de risque conforme SRD §26',
        },
        en: {
          addressee: 'To the Director-General of the Budget — Ministry of Finance',
          title: 'Pre-disbursement advisory — Risk score per SRD §26',
        },
      };
    case 'ANIF':
      return {
        fr: {
          addressee: "À l'attention du Directeur de l'Agence Nationale d'Investigation Financière",
          title: 'Déclaration de soupçon — Élément AML / CTF',
        },
        en: {
          addressee: 'To the Director of the National Financial Investigation Agency',
          title: 'Suspicion declaration — AML / CTF intelligence',
        },
      };
    case 'CDC':
      return {
        fr: {
          addressee: 'À Monsieur le Directeur Général de la Caisse de Dépôts et Consignations',
          title: 'Notification — Décaissement marqué pour vérification',
        },
        en: {
          addressee: 'To the Director-General of the Caisse de Dépôts et Consignations',
          title: 'Notification — Disbursement flagged for verification',
        },
      };
    case 'OTHER':
      return {
        fr: {
          addressee: "À l'attention de l'autorité destinataire désignée",
          title: 'Notification — Constatation transmise',
        },
        en: {
          addressee: 'To the designated recipient authority',
          title: 'Notification — Finding transmitted',
        },
      };
  }
}
