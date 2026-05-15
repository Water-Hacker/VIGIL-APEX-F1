import { z } from 'zod';

import { zIsoInstant, zSha256Hex, zUuid } from './common.js';

/* =============================================================================
 * Audit chain — Postgres hash chain (W-11 fix; replaces Fabric for MVP).
 *
 * Every consequential action emits one row. Each row carries:
 *   - prev_hash (SHA-256 of the previous row's serialised body)
 *   - body_hash (SHA-256 of THIS row's serialised body)
 * The chain is verified hourly (CT-01) and anchored to Polygon hourly (CT-02).
 * ===========================================================================*/

export const zAuditAction = z.enum([
  // Lifecycle
  'system.bootstrap',
  'system.shutdown',
  'system.health_degraded',
  // Sentinel-quorum outage. Distinct from system.health_degraded
  // (which is the general TAL-PA category-J / calibration-audit
  // signal); sentinel.quorum_outage is the specific 2-of-3 sentinel
  // attestation that the dashboard / Hetzner ingestion VPS is
  // unreachable from outside the host network. Per BLOCK-E E.0
  // (architect signoff 2026-05-02): one-enum-add; existing rows
  // keep their legacy 'system.health_degraded' value (audit-chain
  // values are immutable).
  'sentinel.quorum_outage',

  // Vault
  'vault.unsealed',
  'vault.sealed',
  'vault.policy_changed',

  // Adapters
  'adapter.scheduled',
  'adapter.run_started',
  'adapter.run_completed',
  'adapter.run_failed',
  'adapter.first_contact_failure',
  'adapter.selector_repaired',

  // Documents
  'document.fetched',
  'document.ipfs_pinned',
  'document.ocr_completed',

  // Findings
  'finding.detected',
  'finding.signal_added',
  'finding.posterior_computed',
  'finding.entered_review',
  'finding.entered_council',
  'finding.dismissed',

  // Governance
  'governance.proposal_opened',
  'governance.vote_cast',
  'governance.proposal_escalated',
  'governance.proposal_dismissed',
  'governance.proposal_expired',
  'governance.member_enrolled',
  'governance.member_resigned',
  'governance.pressure_reported',

  // Dossiers
  'dossier.rendered',
  'dossier.signed',
  'dossier.delivered',
  'dossier.acknowledged',
  'dossier.delivery_failed',
  'dossier.signing_key_rotated',
  // DECISION-010 — body-name routing + per-finding download
  'dossier.render_enqueued',
  'dossier.recipient_body_changed',
  'dossier.downloaded',
  // FIND-002 closure (whole-system-audit doc 10) — emitted when
  // worker-governance refuses to publish a dossier.render envelope
  // because the underlying finding does not meet the CONAC threshold
  // (posterior >= 0.95 AND signal_count >= 5), AND when
  // worker-conac-sftp dead-letters at the SFTP boundary for the same
  // reason.
  'dossier.render_blocked_below_threshold',
  'satellite.request_enqueued',
  'satellite.imagery_fetched',
  'satellite.recheck_requested',

  // Tips
  'tip.received',
  'tip.triaged',
  'tip.promoted_to_finding',
  'tip.dismissed',
  'tip.decrypted',
  // FRONTIER-AUDIT E1.4 — multi-channel ingestion. Emitted by
  // worker-tip-channels after a USSD / SMS / voice tip has been
  // encrypted, persisted, and assigned a TIP-YYYY-NNNN reference.
  // Payload carries channel + language + ciphertext byte length only —
  // never plaintext, never MSISDN.
  'audit.tip_received_channel',
  // FRONTIER-AUDIT Layer-7 — outcome feedback loop. Emitted by
  // worker-outcome-feedback after a delivered dossier has been
  // matched against an external operational signal (CONAC press,
  // court ruling, ARMP debarment, ANIF bulletin, MINFI clawback).
  'audit.dossier_outcome_matched',
  // FRONTIER-AUDIT E1.1 third element — pattern discovery on the
  // entity graph. Emitted by worker-pattern-discovery for each
  // graph anomaly that exceeds the alert threshold.
  'audit.pattern_anomaly_detected',

  // Calibration
  'calibration.entry_added',
  'calibration.entry_redacted',
  'calibration.recomputed',

  // Anchoring
  'audit.anchor_committed',
  'audit.anchor_failed',
  'audit.hash_chain_verified',
  'audit.hash_chain_break',

  // DECISION-012 — TAL-PA public-permanence export
  'audit.public_export_published',

  // FIND-005 closure (whole-system-audit doc 10) — periodic
  // reconciliation between Postgres, Fabric witness, and Polygon anchor.
  // worker-reconcil-audit emits these.
  'audit.reconciliation_completed',
  'audit.reconciliation_divergence',

  // Phase / decision
  'phase.advanced',
  'decision.recorded',
  'decision.superseded',
]);
export type AuditAction = z.infer<typeof zAuditAction>;

export const zAuditEvent = z.object({
  id: zUuid,
  /** Monotonic sequence — gap-detection. */
  seq: z.number().int().nonnegative(),
  action: zAuditAction,
  actor: z.string().min(1).max(200), // service name OR user ID OR council member address
  subject_kind: z.enum([
    'system',
    'finding',
    'dossier',
    'proposal',
    'member',
    'tip',
    'document',
    'adapter',
    'calibration_entry',
    'decision',
    'phase',
  ]),
  subject_id: z.string().min(1).max(200),
  occurred_at: zIsoInstant,
  payload: z.record(z.unknown()).default({}),
  prev_hash: zSha256Hex.nullable(), // null only for the genesis row
  body_hash: zSha256Hex,
});
export type AuditEvent = z.infer<typeof zAuditEvent>;

/* =============================================================================
 * Anchor commitment — periodic root anchored to Polygon mainnet.
 * ===========================================================================*/

export const zAnchorCommitment = z.object({
  id: zUuid,
  audit_event_seq_from: z.number().int().nonnegative(),
  audit_event_seq_to: z.number().int().nonnegative(),
  root_hash: zSha256Hex,
  committed_at: zIsoInstant,
  polygon_tx_hash: z
    .string()
    .regex(/^0x[a-f0-9]{64}$/i)
    .nullable(),
  polygon_block_number: z.number().int().positive().nullable(),
  polygon_confirmed_at: zIsoInstant.nullable(),
});
export type AnchorCommitment = z.infer<typeof zAnchorCommitment>;
