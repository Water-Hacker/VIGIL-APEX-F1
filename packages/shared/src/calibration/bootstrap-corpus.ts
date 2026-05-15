/**
 * Calibration corpus bootstrap framework — FRONTIER-AUDIT E1.2 closure.
 *
 * Purpose
 * -------
 * Until the architect + senior operators have hand-graded ≥ 30 cases per
 * EXEC §20.3 (Phase-9 gate) the live `calibration_entry` table is empty.
 * That is correct — promotion of new defaultPrior/defaultWeight values
 * MUST be gated on ground-truth labels with the two-source evidence rule
 * (EXEC §23). But empty also means:
 *
 *   - the calibration dashboard renders no buckets,
 *   - the per-pattern misalignment report has nothing to compute against,
 *   - new operators cannot learn the labelling discipline by inspection.
 *
 * The bootstrap framework solves the "cold-start" by providing two
 * carefully labelled artefacts:
 *
 *   1. A **synthetic case template** — a deterministic generator that
 *      produces parameterised pattern-aligned cases the architect can
 *      use to (a) sanity-check the pipeline end-to-end before any real
 *      grades exist, and (b) calibrate operator-grader judgment in a
 *      controlled setting where the "truth" is by construction known.
 *
 *   2. A **published-case skeleton corpus** — a small set of historical
 *      Cameroonian and CEMAC corruption incidents already on the public
 *      record (Cour des Comptes annual reports, Sparrowhawk archive,
 *      ARMP debarment list, ANIF bulletins) shipped as evidence-citation
 *      templates. Each row carries:
 *         - the case label (free public reference),
 *         - the year,
 *         - the region,
 *         - the pattern category the architect believes applies,
 *         - **the citation lines the architect must verify before
 *           promoting to ground_truth `true_positive`**.
 *
 *      Crucially, the skeleton corpus does **NOT** ship pre-graded
 *      ground-truth labels. EXEC §23 forbids importing labels we cannot
 *      personally re-verify; the skeleton is a *to-grade* worklist, not
 *      a substitute for grading.
 *
 * Both artefacts live in this package because they are pure data + pure
 * helpers. The architect-write `personal/calibration-seed/seed.csv` is
 * **never** populated by this code; it is populated by the architect at
 * the keyboard, with every entry independently witnessed.
 *
 * This module is pure. No I/O. No clock except via `now`. Loader/writer
 * helpers in `seed-io.ts` handle the actual seed.csv parsing.
 */

import { PATTERN_CATEGORIES, type PatternCategoryLetter } from '../constants.js';

/* =============================================================================
 * Synthetic case template — for end-to-end sanity-checks
 * ===========================================================================*/

/**
 * A purely synthetic case for sanity-checking the calibration pipeline.
 * The architect feeds these through the pipeline before real grades exist
 * to confirm that:
 *   - the pattern fires when its conditions are met,
 *   - the posterior bucketing logic produces the expected decile,
 *   - the dashboard renders the calibration card.
 *
 * `ground_truth_by_construction` is the synthetic label — only meaningful
 * INSIDE the synthetic corpus. It is NEVER copied into the real
 * `calibration_entry` table. EXEC §23 ground-truth discipline applies
 * only to real cases backed by ≥ 2 evidence kinds.
 */
export interface SyntheticCalibrationCase {
  readonly id: string;
  readonly pattern_id: string;
  readonly case_label: string;
  readonly case_year: number;
  readonly amount_xaf: number | null;
  readonly posterior_target: number;
  readonly ground_truth_by_construction: 'true_positive' | 'false_positive' | 'partial_match';
  readonly notes: string;
}

export interface SyntheticCorpusOptions {
  /** Number of cases per pattern category. Default 3. */
  readonly perCategory?: number;
  /**
   * Posterior anchor strategy:
   *   - 'spread' (default) — 0.15 / 0.55 / 0.95 to exercise all deciles
   *   - 'matched'         — posteriors match the synthetic ground truth
   */
  readonly posteriorStrategy?: 'spread' | 'matched';
  /** Deterministic seed for the synthetic-id string. Default 'BOOT-2026'. */
  readonly idPrefix?: string;
}

const SPREAD_POSTERIORS = [0.15, 0.55, 0.95] as const;
const SPREAD_LABELS = ['false_positive', 'partial_match', 'true_positive'] as const;

/**
 * Generate a deterministic synthetic corpus that covers every pattern
 * category at least once at each posterior decile of interest. The
 * resulting set is suitable for end-to-end pipeline sanity-checks and
 * for training new operator-graders on the labelling discipline. It is
 * NOT a substitute for the architect-graded EXEC §20.3 floor of 30
 * real cases.
 */
export function generateSyntheticCorpus(
  opts: SyntheticCorpusOptions = {},
): ReadonlyArray<SyntheticCalibrationCase> {
  const perCategory = opts.perCategory ?? 3;
  const strategy = opts.posteriorStrategy ?? 'spread';
  const prefix = opts.idPrefix ?? 'BOOT-2026';

  const out: SyntheticCalibrationCase[] = [];

  for (const def of PATTERN_CATEGORIES) {
    const cat: PatternCategoryLetter = def.letter;
    for (let i = 0; i < perCategory; i += 1) {
      const idx = i % SPREAD_POSTERIORS.length;
      const posterior = SPREAD_POSTERIORS[idx]!;
      const label = SPREAD_LABELS[idx]!;
      const matchedPosterior =
        label === 'true_positive' ? 0.92 : label === 'false_positive' ? 0.18 : 0.55;
      out.push({
        id: `${prefix}-${cat}-${String(i + 1).padStart(3, '0')}`,
        pattern_id: `P-${cat}-001`,
        case_label: `Synthetic ${cat}-bootstrap case #${i + 1}`,
        case_year: 2026,
        amount_xaf: synthAmountForCategory(cat, i),
        posterior_target: strategy === 'spread' ? posterior : matchedPosterior,
        ground_truth_by_construction: label,
        notes:
          `Synthetic case auto-generated by bootstrap-corpus.ts. NOT a real grade. ` +
          `Used to sanity-check pipeline ${cat}-channel end-to-end before EXEC §20.3 floor reached.`,
      });
    }
  }
  return out;
}

function synthAmountForCategory(cat: PatternCategoryLetter, i: number): number | null {
  const base: Record<PatternCategoryLetter, number | null> = {
    A: 250_000_000,
    B: 1_500_000_000,
    C: 60_000_000,
    D: 800_000_000,
    E: 200_000_000,
    F: 90_000_000,
    G: null,
    H: 150_000_000,
    I: 350_000_000,
    J: 2_000_000_000,
    K: 1_200_000_000,
    L: 450_000_000,
    M: 600_000_000,
    N: 4_000_000_000,
    O: 5_000_000_000,
    P: 80_000_000,
  };
  const b = base[cat];
  if (b === null) return null;
  return b + i * 17_000_000;
}

/* =============================================================================
 * Published-case skeleton corpus — to-grade worklist for the architect
 * ===========================================================================*/

/**
 * A skeleton row for the architect's worklist. Each row points to a case
 * that is already on the public record and that the architect believes —
 * **without independent re-verification** — falls under a particular
 * pattern category. The architect promotes a skeleton to a real
 * CalibrationEntry only after personally collecting the ≥ 2 evidence
 * citations EXEC §23 demands.
 */
export interface SkeletonWorklistRow {
  /** Public case label — the architect uses this to find sources. */
  readonly case_label: string;
  /** Approximate year of the underlying conduct. */
  readonly case_year: number;
  /** Region in Cameroon (or null for cross-region / cross-border). */
  readonly region: 'AD' | 'CE' | 'ES' | 'EN' | 'LT' | 'NO' | 'NW' | 'OU' | 'SU' | 'SW' | null;
  /** Best-fit pattern category — architect verifies and may refine. */
  readonly suggested_category: PatternCategoryLetter;
  /** Sources the architect MUST consult before promoting to a real grade. */
  readonly citation_lines: ReadonlyArray<string>;
  /**
   * Architect's flag: when true, the case is *publicly contested* (the
   * defendant maintains innocence, court decision under appeal, or
   * judgment was overturned). These cases are highest-value for
   * calibration (they exercise the "FP" channel) but require the
   * strictest evidence discipline.
   */
  readonly publicly_contested: boolean;
}

/**
 * The skeleton worklist is intentionally short (≤ 20 rows) and consists
 * only of cases already exhaustively documented in Cameroonian or CEMAC
 * public record. It is a *starting point* for the architect's 30-entry
 * Phase-9 floor — not the entirety of that floor. Source citations are
 * directional ("Cour des Comptes Annual Report 2019, Chapter on MINSANTE
 * execution"); the architect retrieves the actual document, transcribes
 * the relevant passage, and records it as `CalibrationEvidence`.
 *
 * This list is deliberately conservative: every entry refers to a case
 * with a public judicial or administrative finding. None of them rely on
 * journalistic reporting alone (EXEC §23 forbids single-source press
 * citations).
 */
export const SKELETON_WORKLIST: ReadonlyArray<SkeletonWorklistRow> = [
  {
    case_label: 'Operation Sparrowhawk — Tribunal Criminel Spécial archive (2012–present)',
    case_year: 2012,
    region: null,
    suggested_category: 'A',
    citation_lines: [
      'Tribunal Criminel Spécial judgments archive (Yaoundé)',
      'Operation Sparrowhawk consolidated case list (public arrests / convictions only)',
    ],
    publicly_contested: false,
  },
  {
    case_label: 'Cour des Comptes annual report 2019 — MINSANTE execution chapter',
    case_year: 2019,
    region: 'CE',
    suggested_category: 'D',
    citation_lines: [
      'Cour des Comptes Annual Report 2019, MINSANTE chapter',
      'MINFI counter-rapport 2019/2020',
    ],
    publicly_contested: false,
  },
  {
    case_label: 'CONAC annual report — Direction Routes case (illustrative D-category)',
    case_year: 2018,
    region: 'CE',
    suggested_category: 'D',
    citation_lines: [
      'CONAC Annual Report 2018, Direction Routes chapter',
      'MINTP press communiqué corroboration',
    ],
    publicly_contested: false,
  },
  {
    case_label: 'ARMP debarment list — example A-category procurement collusion',
    case_year: 2021,
    region: null,
    suggested_category: 'M',
    citation_lines: [
      'ARMP Public Debarment List entry (consult ARMP website archive)',
      'Tender award gazette of the year',
    ],
    publicly_contested: false,
  },
  {
    case_label: 'ANIF Bulletin 2022 — TBML typology illustrative case',
    case_year: 2022,
    region: 'LT',
    suggested_category: 'K',
    citation_lines: [
      'ANIF 2022 typology bulletin (public release)',
      'CRF-CEMAC corroboration of typology',
    ],
    publicly_contested: false,
  },
  {
    case_label: 'Operation Épervier — high-court conviction (2014 cohort)',
    case_year: 2014,
    region: null,
    suggested_category: 'I',
    citation_lines: [
      'Tribunal Criminel Spécial 2014 dossier list',
      'Court of Appeal final judgment',
    ],
    publicly_contested: true,
  },
  {
    case_label: 'EITI Cameroon Report — extractive-sector under-declaration (2017)',
    case_year: 2017,
    region: 'SW',
    suggested_category: 'O',
    citation_lines: [
      'EITI Cameroon 2017 reconciliation report',
      'SNH counter-rapport on the same fiscal year',
    ],
    publicly_contested: false,
  },
  {
    case_label: 'Public-figure asset declaration mismatch — Loi 2018/011 patrimoine inexpliqué',
    case_year: 2019,
    region: null,
    suggested_category: 'P',
    citation_lines: [
      'CONAC patrimony declaration (public, where published)',
      'Cour des Comptes corroboration where the same official appears in execution chapter',
    ],
    publicly_contested: true,
  },
  {
    case_label: 'Dismissed-by-court tender protest (illustrative FP candidate)',
    case_year: 2020,
    region: 'CE',
    suggested_category: 'A',
    citation_lines: [
      'Court ruling dismissing the protest with prejudice',
      'ARMP closure note for the same tender',
    ],
    publicly_contested: false,
  },
  {
    case_label: 'Presidential-decree emergency procurement (justified expediency case)',
    case_year: 2021,
    region: null,
    suggested_category: 'A',
    citation_lines: [
      'Presidential decree authorising emergency procurement',
      'Cour des Comptes finding that no irregularity occurred',
    ],
    publicly_contested: false,
  },
];

/* =============================================================================
 * Architect-grading discipline helpers
 * ===========================================================================*/

/**
 * Two-source evidence rule per EXEC §23. Given a proposed CalibrationEntry's
 * evidence kinds, returns whether the entry is admissible.
 *
 * Rules:
 *   - At least 2 distinct evidence kinds must be present.
 *   - At least 1 must be a "primary" kind (court_judgement,
 *     cour_comptes_observation, conac_finding, criminal_conviction,
 *     dismissed_by_court, presidential_decree_emergency, disciplinary_action,
 *     official_communique).
 *   - Press / civil-society / WHO corroboration alone is insufficient.
 */
export type CalibrationEvidenceKind =
  | 'court_judgement'
  | 'cour_comptes_observation'
  | 'conac_finding'
  | 'criminal_conviction'
  | 'dismissed_by_court'
  | 'presidential_decree_emergency'
  | 'disciplinary_action'
  | 'press_corroboration'
  | 'civil_society_report'
  | 'official_communique'
  | 'who_corroboration';

const PRIMARY_EVIDENCE_KINDS: ReadonlySet<CalibrationEvidenceKind> = new Set([
  'court_judgement',
  'cour_comptes_observation',
  'conac_finding',
  'criminal_conviction',
  'dismissed_by_court',
  'presidential_decree_emergency',
  'disciplinary_action',
  'official_communique',
]);

export interface AdmissibilityResult {
  readonly admissible: boolean;
  readonly distinct_kinds: number;
  readonly has_primary_kind: boolean;
  readonly reason: string;
}

export function checkEvidenceAdmissibility(
  kinds: ReadonlyArray<CalibrationEvidenceKind>,
): AdmissibilityResult {
  const set = new Set(kinds);
  const distinct = set.size;
  const hasPrimary = [...set].some((k) => PRIMARY_EVIDENCE_KINDS.has(k));
  if (distinct < 2) {
    return {
      admissible: false,
      distinct_kinds: distinct,
      has_primary_kind: hasPrimary,
      reason: 'EXEC §23: at least 2 distinct evidence kinds required',
    };
  }
  if (!hasPrimary) {
    return {
      admissible: false,
      distinct_kinds: distinct,
      has_primary_kind: false,
      reason: 'EXEC §23: at least 1 primary (judicial / audit-court / regulator) source required',
    };
  }
  return {
    admissible: true,
    distinct_kinds: distinct,
    has_primary_kind: true,
    reason: 'OK',
  };
}

/* =============================================================================
 * Phase-9 gate summary — useful for the dashboard banner
 * ===========================================================================*/

export interface Phase9GateStatus {
  readonly current_count: number;
  readonly floor: number;
  readonly target_per_category_density: number;
  readonly long_horizon_target: number;
  readonly floor_reached: boolean;
  readonly density_target_reached: boolean;
  readonly horizon_target_reached: boolean;
  readonly cases_remaining_to_floor: number;
}

export const PHASE9_FLOOR = 30;
export const PHASE9_DENSITY_TARGET = 50;
export const PHASE9_HORIZON_TARGET = 200;

export function summarisePhase9Gate(currentGradedCount: number): Phase9GateStatus {
  const safe = Math.max(0, Math.floor(currentGradedCount));
  return {
    current_count: safe,
    floor: PHASE9_FLOOR,
    target_per_category_density: PHASE9_DENSITY_TARGET,
    long_horizon_target: PHASE9_HORIZON_TARGET,
    floor_reached: safe >= PHASE9_FLOOR,
    density_target_reached: safe >= PHASE9_DENSITY_TARGET,
    horizon_target_reached: safe >= PHASE9_HORIZON_TARGET,
    cases_remaining_to_floor: Math.max(0, PHASE9_FLOOR - safe),
  };
}
