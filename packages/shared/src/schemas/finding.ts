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
 * Finding — the core domain object.
 *
 * A Finding is produced when one or more PatternDef matches fire on a subject
 * (Tender / Company / Person / Project). Each pattern firing produces one or
 * more Signals; signals are combined by the Bayesian engine to compute a
 * posterior. Findings above 0.85 enter the escalation queue.
 *
 * Lifecycle (state machine):
 *   detected → review → council_review → escalated | dismissed | inconclusive
 * ===========================================================================*/

export const zFindingState = z.enum([
  'detected',           // pattern fired
  'review',             // operator queue
  'council_review',     // proposal opened on Polygon
  'escalated',          // 3-of-5 voted YES; routed to recipient
  'dismissed',          // 3-of-5 voted NO, OR operator dismissed
  'inconclusive',       // vote window expired without quorum
  'archived',           // closed for any other reason
]);
export type FindingState = z.infer<typeof zFindingState>;

export const zSignalSource = z.enum(['pattern', 'tip', 'satellite', 'corroboration', 'manual']);
export type SignalSource = z.infer<typeof zSignalSource>;

export const zSignal = z.object({
  id: zUuid,
  finding_id: zUuid,
  source: zSignalSource,
  pattern_id: zPatternId.nullable(), // null when source !== 'pattern'
  /** Per-signal raw strength in [0, 1] — likelihood ratio is derived. */
  strength: z.number().min(0).max(1),
  prior: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
  evidence_event_ids: z.array(zUuid).max(50),
  evidence_document_cids: z.array(z.string()).default([]),
  contributed_at: zIsoInstant,
  metadata: z.record(z.unknown()).default({}),
});
export type Signal = z.infer<typeof zSignal>;

export const zFinding = z.object({
  id: zUuid,
  state: zFindingState,
  /** Subject of the finding — denormalised foreign key. */
  primary_entity_id: zUuid.nullable(),
  related_entity_ids: z.array(zUuid).max(50),
  amount_xaf: zXafAmount.nullable(),
  region: zCmrRegion.nullable(),
  severity: zSeverity,
  /** Bayesian engine output; null until at least one signal arrives. */
  posterior: z.number().min(0).max(1).nullable(),
  signal_count: z.number().int().nonnegative(),
  /** Human-readable summary, FR primary, EN automatic. */
  title_fr: z.string().min(5).max(300),
  title_en: z.string().min(5).max(300),
  summary_fr: z.string().max(2_000),
  summary_en: z.string().max(2_000),
  /** Counter-evidence (devil's-advocate) summary — populated at posterior >= 0.85. */
  counter_evidence: z.string().max(5_000).nullable(),
  /** Lifecycle tracking. */
  detected_at: zIsoInstant,
  last_signal_at: zIsoInstant,
  council_proposal_index: z.string().nullable(), // on-chain ProposalIndex
  council_voted_at: zIsoInstant.nullable(),
  council_yes_votes: z.number().int().min(0).max(5),
  council_no_votes: z.number().int().min(0).max(5),
  council_recused_addresses: z.array(z.string()).default([]),
  /** Closure metadata. */
  closed_at: zIsoInstant.nullable(),
  closure_reason: z.string().max(500).nullable(),
});
export type Finding = z.infer<typeof zFinding>;

/* =============================================================================
 * Pattern result — one PatternDef.detect() output, before becoming a Signal.
 * ===========================================================================*/

export const zPatternResult = z.object({
  pattern_id: zPatternId,
  matched: z.boolean(),
  strength: z.number().min(0).max(1),
  contributing_event_ids: z.array(zUuid).max(50),
  contributing_document_cids: z.array(z.string()).default([]),
  rationale: z.string().max(1_000),
});
export type PatternResult = z.infer<typeof zPatternResult>;
