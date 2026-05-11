import { z } from 'zod';

import { zCorrelationId, zIsoInstant, zSha256Hex, zUuid } from './common.js';

/* =============================================================================
 * TAL-PA — Total Action Logging with Public Anchoring (DECISION-012).
 *
 * Per the binding doctrine at docs/source/TAL-PA-DOCTRINE-v1.md:
 *   - every action by every user produces a UserActionEvent
 *   - every event chains to the actor's previous event (per-actor hash chain)
 *   - every event hashes to a global Merkle root anchored to Polygon hourly
 *   - high-significance events are anchored individually within seconds
 *   - the public audit web portal exposes a scoped subset to anyone on Earth
 *   - the platform halts user-facing operations if the audit emitter fails
 *
 * `Schemas.UserActionEvent` is the canonical wire shape. Workers + the
 * dashboard import the typed helpers in `@vigil/audit-log` rather than
 * constructing this directly so the chaining + signing wiring stays
 * centralised.
 * ===========================================================================*/

export const zAuditCategory = z.enum([
  'A', // Authentication
  'B', // Search and Query
  'C', // Document and Dossier Access
  'D', // Decision and Vote
  'E', // Data Modification
  'F', // Configuration and Administrative
  'G', // System
  'H', // External Communication
  'I', // Public Portal
  'J', // Failed and Suspicious
  'K', // Audit and Audit-Of-Audit
]);
export type AuditCategory = z.infer<typeof zAuditCategory>;

export const zResultStatus = z.enum(['success', 'denied', 'error', 'partial']);
export type ResultStatus = z.infer<typeof zResultStatus>;

export const zActorRole = z.enum([
  'architect',
  'analyst',
  'pillar_governance',
  'pillar_judicial',
  'pillar_civil_society',
  'pillar_audit',
  'pillar_technical',
  'external_auditor',
  'public',
  'system',
  'tip_handler',
  'auditor',
  'operator',
  'civil_society',
  'council_member',
]);
export type ActorRole = z.infer<typeof zActorRole>;

/**
 * Canonical event_type registry — `<category>.<subtype>` slug.
 * The TAL-PA SDK exports a typed helper per slug; the regex below is the
 * runtime contract.
 *
 * Every slug used in production must appear in `KNOWN_EVENT_TYPES` for the
 * coverage tests in `packages/audit-log/__tests__/coverage.test.ts` so a
 * silent type proliferation is caught at CI.
 */
export const EVENT_TYPE_RE =
  /^(auth|search|query|graph|dossier|vote|signature|analyst|record|status|classification|priority|prompt|model|threshold|likelihood_ratio|user|permission|yubikey|system|external|public|failed|audit|redaction)\.[a-z_]+$/;

export const zEventType = z
  .string()
  .min(5)
  .max(120)
  .regex(EVENT_TYPE_RE, 'event_type must be category.subtype with snake_case subtype');
export type EventType = z.infer<typeof zEventType>;

/** Known event-type slugs grouped by TAL-PA category. */
export const KNOWN_EVENT_TYPES = {
  // Category A — Authentication
  A: [
    'auth.login_attempted',
    'auth.login_succeeded',
    'auth.login_failed',
    'auth.yubikey_touched',
    'auth.yubikey_pin_entered',
    'auth.session_created',
    'auth.session_refreshed',
    'auth.session_terminated',
    'auth.mfa_challenge_issued',
    'auth.mfa_challenge_succeeded',
    'auth.mfa_challenge_failed',
    'auth.logout',
  ],
  // Category B — Search & Query
  B: [
    'search.entity',
    'search.fulltext',
    'query.filter_applied',
    'query.saved',
    'query.zero_results',
    'query.executed',
    'graph.traversal',
  ],
  // Category C — Document / Dossier Access
  C: [
    'dossier.opened',
    'dossier.page_scrolled',
    'dossier.exported_pdf',
    'dossier.printed',
    'dossier.copied_to_clipboard',
    'dossier.downloaded',
    'dossier.redistributed',
  ],
  // Category D — Decision & Vote
  D: [
    'vote.cast',
    'vote.abstained',
    'vote.refused',
    'signature.applied',
    'analyst.cleared',
    'analyst.rejected',
  ],
  // Category E — Data Modification
  E: [
    'record.created',
    'record.edited',
    'record.deleted',
    'status.changed',
    'classification.changed',
    'priority.adjusted',
  ],
  // Category F — Configuration & Administrative
  F: [
    'prompt.version_committed',
    'model.version_pinned',
    'likelihood_ratio.adjusted',
    'threshold.changed',
    'user.added',
    'user.removed',
    'permission.granted',
    'permission.revoked',
    // FIND-001 closure (whole-system-audit doc 10) — every forbidden-access
    // attempt from the middleware's 403 rewrite path emits this event so
    // an investigator can reconstruct probing patterns post-incident.
    'permission.denied',
    'yubikey.enrolled',
    'yubikey.revoked',
  ],
  // Category G — System
  G: [
    'system.container_started',
    'system.container_stopped',
    'system.container_restarted',
    'system.backup_started',
    'system.backup_completed',
    'system.snapshot_replicated',
    'system.nas_failover',
    'system.bedrock_failover',
    'system.rate_limit_hit',
    'system.cost_threshold_crossed',
  ],
  // Category H — External Communication
  H: [
    'external.api_call',
    'external.dossier_transmitted',
    'external.receipt_acknowledged',
    'external.email_sent',
  ],
  // Category I — Public Portal
  I: [
    'public.tip_submitted',
    'public.voice_tip_transcribed',
    'public.dashboard_viewed',
    'public.report_downloaded',
  ],
  // Category J — Failed & Suspicious
  J: [
    'failed.auth',
    'failed.authorization',
    'failed.schema_validation',
    'failed.canary_triggered',
    'failed.multi_pass_disagreement',
    'failed.counterfactual_probe',
  ],
  // Category K — Audit-of-Audit
  K: [
    'audit.query_executed',
    'audit.external_auditor_access',
    'redaction.performed',
    'audit.chain_verified',
    'audit.public_export_published',
  ],
} as const satisfies Record<AuditCategory, ReadonlyArray<string>>;

/**
 * Returns the TAL-PA category for an event_type slug. Used by the public
 * scoping function to decide what fields to redact in the public view.
 */
export function categoryOf(eventType: string): AuditCategory | null {
  for (const [cat, slugs] of Object.entries(KNOWN_EVENT_TYPES) as Array<
    [AuditCategory, readonly string[]]
  >) {
    if (slugs.includes(eventType)) return cat;
  }
  // Fall back to a regex-derived prefix mapping for unknown slugs.
  if (/^auth\./.test(eventType)) return 'A';
  if (/^(search|query|graph)\./.test(eventType)) return 'B';
  if (/^dossier\./.test(eventType)) return 'C';
  if (/^(vote|signature|analyst)\./.test(eventType)) return 'D';
  if (/^(record|status|classification|priority)\./.test(eventType)) return 'E';
  if (/^(prompt|model|threshold|likelihood_ratio|user|permission|yubikey)\./.test(eventType))
    return 'F';
  if (/^system\./.test(eventType)) return 'G';
  if (/^external\./.test(eventType)) return 'H';
  if (/^public\./.test(eventType)) return 'I';
  if (/^failed\./.test(eventType)) return 'J';
  if (/^(audit|redaction)\./.test(eventType)) return 'K';
  return null;
}

/**
 * Event types that are anchored to Polygon individually within seconds
 * rather than batched hourly (TAL-PA doctrine §"High-Significance Events").
 */
export const HIGH_SIGNIFICANCE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'vote.cast',
  'vote.abstained',
  'vote.refused',
  'signature.applied',
  'analyst.cleared',
  'analyst.rejected',
  'external.dossier_transmitted',
  'prompt.version_committed',
  'model.version_pinned',
  'user.added',
  'user.removed',
  'failed.canary_triggered',
  'redaction.performed',
  'yubikey.enrolled',
  'yubikey.revoked',
]);

export function isHighSignificance(eventType: string): boolean {
  return HIGH_SIGNIFICANCE_EVENT_TYPES.has(eventType);
}

/**
 * Per-event metadata about the human (or system) that took the action.
 * `actor_id` is `system:<service>` for machine events.
 */
export const zActorContext = z.object({
  actor_id: z.string().min(1).max(200),
  actor_role: zActorRole,
  /** Hardware serial of the YubiKey used. null for non-YubiKey-bound actors
   *  (system, public). */
  actor_yubikey_serial: z.string().max(40).nullable(),
  actor_ip: z.string().max(45).nullable(), // ipv6 max 39
  /** SHA-256 of (TLS fingerprint || user-agent || screen resolution). */
  actor_device_fingerprint: zSha256Hex.nullable(),
  /** Session id under which the event happened. null for unauth events. */
  session_id: zUuid.nullable(),
});
export type ActorContext = z.infer<typeof zActorContext>;

/**
 * The canonical UserActionEvent. Every audit emit produces one row.
 *
 * `prior_event_id` is the event_id of the most recent event by the same
 * actor — forms a per-actor hash chain. The first event by any actor has
 * `prior_event_id = null`.
 *
 * `record_hash` is SHA-256 over the canonical JSON serialisation of every
 * field except `record_hash` itself. The value is what gets included in
 * the global Merkle root anchored to Polygon.
 *
 * `chain_anchor_tx` is populated asynchronously by `worker-anchor` once
 * the event is included in a Polygon anchor commitment.
 */
export const zUserActionEvent = z.object({
  event_id: zUuid,
  /** The global `audit.actions.id` row this TAL-PA event corresponds to.
   *  Provides a cross-link from the rich TAL-PA chain back to the
   *  pre-existing global hash chain. */
  global_audit_id: zUuid,
  event_type: zEventType,
  category: zAuditCategory,
  timestamp_utc: zIsoInstant,
  actor: zActorContext,
  target_resource: z.string().min(1).max(500),
  /** Full action detail — redacted only for protected categories at public-view time. */
  action_payload: z.record(z.unknown()).default({}),
  result_status: zResultStatus,
  prior_event_id: zUuid.nullable(),
  correlation_id: zCorrelationId.nullable(),
  /** Actor's YubiKey signature (hex) over `record_hash`. null for events
   *  produced by accounts not yet enrolled or for `system:` actors. */
  digital_signature: z
    .string()
    .regex(/^[a-f0-9]+$/)
    .max(2048)
    .nullable(),
  /** Polygon transaction hash where this event's record was anchored.
   *  null until the next batch (or immediate, for high-sig). */
  chain_anchor_tx: z
    .string()
    .regex(/^0x[a-f0-9]{64}$/i)
    .nullable(),
  record_hash: zSha256Hex,
  /** True iff this event was anchored individually within seconds rather
   *  than via the hourly batch. */
  high_significance: z.boolean().default(false),
});
export type UserActionEvent = z.infer<typeof zUserActionEvent>;

export const zSession = z.object({
  id: zUuid,
  actor_id: z.string().min(1).max(200),
  actor_role: zActorRole,
  started_at: zIsoInstant,
  expires_at: zIsoInstant,
  terminated_at: zIsoInstant.nullable(),
  /** SHA-256 of (TLS fingerprint || user-agent || screen resolution). */
  device_fingerprint: zSha256Hex.nullable(),
  /** Last IP observed on this session. */
  last_ip: z.string().max(45).nullable(),
  /** YubiKey serial used to bootstrap the session. */
  yubikey_serial: z.string().max(40).nullable(),
});
export type Session = z.infer<typeof zSession>;

export const zRedaction = z.object({
  id: zUuid,
  event_id: zUuid,
  redacted_fields: z.array(z.string().min(1).max(120)).min(1),
  rationale: z.string().min(8).max(2_000),
  redacted_by: z.string().min(1).max(200),
  redacted_at: zIsoInstant,
  /** `audit.actions.id` of the redaction-of-audit record. Required. */
  audit_event_id: zUuid,
});
export type Redaction = z.infer<typeof zRedaction>;

export const zAnomalyKind = z.enum([
  'fishing_query_pattern',
  'after_hours_dossier_access',
  'analyst_clearance_uniform',
  'council_repeated_abstention',
  'auth_burst_new_ip',
  'export_volume_spike',
  'sensitive_entity_query',
  'config_change_without_pr',
  'yubikey_geographic_improbable',
  'dossier_view_no_signature',
]);
export type AnomalyKind = z.infer<typeof zAnomalyKind>;

export const zAnomalyAlert = z.object({
  id: zUuid,
  kind: zAnomalyKind,
  actor_id: z.string().min(1).max(200),
  /** Window of activity that triggered the alert. */
  window_start: zIsoInstant,
  window_end: zIsoInstant,
  /** Human-readable summary, bilingual FR/EN per platform convention. */
  summary_fr: z.string().min(1).max(1_000),
  summary_en: z.string().min(1).max(1_000),
  /** Severity for ops triage. */
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  /** Trigger-rule version, so anomaly produced under one rule version is
   *  reproducible. */
  rule_version: z.string().regex(/^v\d+\.\d+\.\d+$/),
  /** Event ids that the rule fired against. */
  triggering_event_ids: z.array(zUuid).max(200),
  detected_at: zIsoInstant,
  /** Operational state — open / acknowledged / dismissed / promoted_to_finding. */
  state: z.enum(['open', 'acknowledged', 'dismissed', 'promoted_to_finding']).default('open'),
});
export type AnomalyAlert = z.infer<typeof zAnomalyAlert>;

/**
 * Public-view shape — what the public audit interface exposes per event.
 * Everything personally-identifying is dropped; queries with PII have the
 * literal string hashed; the actor's role (not id) is preserved.
 *
 * Doctrine §"What the Public Sees" / §"What the Public Does Not See".
 */
export const zPublicAuditView = z.object({
  event_id: zUuid,
  event_type: zEventType,
  category: zAuditCategory,
  timestamp_utc: zIsoInstant,
  /** Role only — never the user id. */
  actor_role: zActorRole,
  /** True iff the actor is an authenticated platform user (vs a public
   *  visitor); preserves aggregate query patterns by role. */
  actor_authenticated: z.boolean(),
  /** Target resource is included for D / E / F / I categories; replaced
   *  with `[REDACTED:CATEGORY-X]` for B / C events to protect query PII. */
  target_resource: z.string().min(1).max(500),
  result_status: zResultStatus,
  /** Polygon anchor tx if known. */
  chain_anchor_tx: z
    .string()
    .regex(/^0x[a-f0-9]{64}$/i)
    .nullable(),
  high_significance: z.boolean(),
});
export type PublicAuditView = z.infer<typeof zPublicAuditView>;

/**
 * Quarterly export manifest — one row per quarter, recording the IPFS CID
 * of the published anonymised CSV. The export job emits an
 * audit.public_export_published event after pinning.
 */
export const zPublicExportManifest = z.object({
  id: zUuid,
  period_label: z.string().regex(/^\d{4}-Q[1-4]$/),
  period_start: zIsoInstant,
  period_end: zIsoInstant,
  csv_sha256: zSha256Hex,
  csv_cid: z.string().regex(/^b[a-z2-7]{55,}$/), // CIDv1
  row_count: z.number().int().nonnegative(),
  exported_at: zIsoInstant,
  audit_event_id: zUuid,
});
export type PublicExportManifest = z.infer<typeof zPublicExportManifest>;
