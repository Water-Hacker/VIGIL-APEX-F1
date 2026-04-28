import { z } from 'zod';

import {
  zCmrRegion,
  zIsoInstant,
  zPatternId,
  zSeverity,
  zUuid,
  zXafAmount,
} from './common.js';

/* =============================================================================
 * Calibration entry — one historical case used to compute ECE. EXEC §22.2.
 *
 * Stored row-level-secured: tip-handlers cannot see; auditors read-only;
 * public sees only aggregate ECE/Brier metrics, never individual case names.
 * ===========================================================================*/

export const zCalibrationGroundTruth = z.enum([
  'true_positive',
  'false_positive',
  'partial_match',
  'pending', // excluded from ECE until resolved
]);
export type CalibrationGroundTruth = z.infer<typeof zCalibrationGroundTruth>;

export const zCalibrationEvidenceKind = z.enum([
  'court_judgement',
  'cour_comptes_observation',
  'conac_finding',
  'criminal_conviction',
  'dismissed_by_court',
  'presidential_decree_emergency',
  'disciplinary_action',
  'press_corroboration',
  'civil_society_report',
  'official_communique',
  'who_corroboration',
]);
export type CalibrationEvidenceKind = z.infer<typeof zCalibrationEvidenceKind>;

export const zCalibrationEvidence = z.object({
  kind: zCalibrationEvidenceKind,
  citation: z.string().min(3).max(500),
  excerpt: z.string().max(2_000).optional(),
});
export type CalibrationEvidence = z.infer<typeof zCalibrationEvidence>;

export const zCalibrationEntry = z.object({
  id: zUuid,
  recorded_at: zIsoInstant,
  pattern_id: zPatternId,
  finding_id: zUuid, // synthetic for historical cases
  case_label: z.string().min(3).max(120),
  case_year: z.number().int().min(1990).max(2199),
  region: zCmrRegion.nullable(),
  amount_xaf: zXafAmount.nullable(),
  /** Architect's best estimate of what posterior the system WOULD have produced. */
  posterior_at_review: z.number().min(0).max(1),
  severity_at_review: zSeverity,
  ground_truth: zCalibrationGroundTruth,
  ground_truth_recorded_by: z.string().min(1).max(80),
  ground_truth_evidence: z.array(zCalibrationEvidence).min(1).max(10),
  closure_reason: z.string().max(200).nullable(),
  notes: z.string().max(2_000),
  /** Optional redaction layer (EXEC §24.3). */
  redacted: z.boolean().default(false),
});
export type CalibrationEntry = z.infer<typeof zCalibrationEntry>;

/* =============================================================================
 * ECE / Brier score reports — emitted nightly per CT-06.
 * ===========================================================================*/

export const zCalibrationReport = z.object({
  id: zUuid,
  computed_at: zIsoInstant,
  window_days: z.number().int().min(1).max(3650),
  total_entries: z.number().int().nonnegative(),
  graded_entries: z.number().int().nonnegative(),
  ece_overall: z.number().min(0).max(1),
  brier_overall: z.number().min(0).max(1),
  /** Per-pattern breakdown — omitted when bin density < 5. */
  per_pattern: z.array(
    z.object({
      pattern_id: zPatternId,
      n: z.number().int().nonnegative(),
      ece: z.number().min(0).max(1).nullable(),
      brier: z.number().min(0).max(1).nullable(),
      observed_tp_rate: z.number().min(0).max(1).nullable(),
    }),
  ),
});
export type CalibrationReport = z.infer<typeof zCalibrationReport>;
