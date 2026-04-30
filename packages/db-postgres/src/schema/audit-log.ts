import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * DECISION-012 — TAL-PA Drizzle schema.
 *
 * Mirrors `0010_tal_pa.sql`. The existing `audit` Postgres schema is
 * shared with the global hash chain; we re-declare it here to avoid
 * importing across files.
 */
export const auditTalPaSchema = pgSchema('audit');

export const userActionEvent = auditTalPaSchema.table(
  'user_action_event',
  {
    event_id: uuid('event_id').primaryKey().notNull(),
    global_audit_id: uuid('global_audit_id').notNull(),
    event_type: text('event_type').notNull(),
    category: text('category').notNull(),
    timestamp_utc: timestamp('timestamp_utc', { withTimezone: true }).notNull(),
    actor_id: text('actor_id').notNull(),
    actor_role: text('actor_role').notNull(),
    actor_yubikey_serial: text('actor_yubikey_serial'),
    actor_ip: text('actor_ip'),
    actor_device_fingerprint: text('actor_device_fingerprint'),
    session_id: uuid('session_id'),
    target_resource: text('target_resource').notNull(),
    action_payload: jsonb('action_payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    result_status: text('result_status').notNull(),
    prior_event_id: uuid('prior_event_id'),
    correlation_id: uuid('correlation_id'),
    digital_signature: text('digital_signature'),
    chain_anchor_tx: text('chain_anchor_tx'),
    record_hash: text('record_hash').notNull(),
    high_significance: boolean('high_significance').notNull().default(false),
  },
  (t) => ({
    actorIdx: index('user_action_event_actor_idx').on(t.actor_id, t.timestamp_utc),
    categoryIdx: index('user_action_event_category_idx').on(t.category, t.timestamp_utc),
    eventTypeIdx: index('user_action_event_event_type_idx').on(t.event_type, t.timestamp_utc),
    correlationIdx: index('user_action_event_correlation_idx').on(t.correlation_id),
  }),
);

export const userActionChain = auditTalPaSchema.table('user_action_chain', {
  actor_id: text('actor_id').primaryKey().notNull(),
  latest_event_id: uuid('latest_event_id').notNull(),
  latest_event_hash: text('latest_event_hash').notNull(),
  latest_at: timestamp('latest_at', { withTimezone: true }).notNull().defaultNow(),
  event_count: bigint('event_count', { mode: 'number' }).notNull().default(1),
});

export const auditSession = auditTalPaSchema.table('session', {
  id: uuid('id').primaryKey().notNull(),
  actor_id: text('actor_id').notNull(),
  actor_role: text('actor_role').notNull(),
  started_at: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  terminated_at: timestamp('terminated_at', { withTimezone: true }),
  device_fingerprint: text('device_fingerprint'),
  last_ip: text('last_ip'),
  yubikey_serial: text('yubikey_serial'),
});

export const auditRedaction = auditTalPaSchema.table('redaction', {
  id: uuid('id').primaryKey().notNull(),
  event_id: uuid('event_id').notNull(),
  redacted_fields: text('redacted_fields').array().notNull(),
  rationale: text('rationale').notNull(),
  redacted_by: text('redacted_by').notNull(),
  redacted_at: timestamp('redacted_at', { withTimezone: true }).notNull().defaultNow(),
  audit_event_id: uuid('audit_event_id').notNull(),
});

export const publicAnchor = auditTalPaSchema.table(
  'public_anchor',
  {
    id: uuid('id').primaryKey().notNull(),
    event_id: uuid('event_id').notNull(),
    polygon_tx_hash: text('polygon_tx_hash').notNull(),
    anchored_at: timestamp('anchored_at', { withTimezone: true }).notNull().defaultNow(),
    is_individual: boolean('is_individual').notNull().default(true),
  },
  (t) => ({
    eventIdx: index('public_anchor_event_idx').on(t.event_id),
    anchoredAtIdx: index('public_anchor_anchored_at_idx').on(t.anchored_at),
  }),
);

export const anomalyAlert = auditTalPaSchema.table(
  'anomaly_alert',
  {
    id: uuid('id').primaryKey().notNull(),
    kind: text('kind').notNull(),
    actor_id: text('actor_id').notNull(),
    window_start: timestamp('window_start', { withTimezone: true }).notNull(),
    window_end: timestamp('window_end', { withTimezone: true }).notNull(),
    summary_fr: text('summary_fr').notNull(),
    summary_en: text('summary_en').notNull(),
    severity: text('severity').notNull(),
    rule_version: text('rule_version').notNull(),
    triggering_event_ids: uuid('triggering_event_ids')
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    detected_at: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    state: text('state').notNull().default('open'),
  },
  (t) => ({
    actorIdx: index('anomaly_alert_actor_idx').on(t.actor_id, t.detected_at),
  }),
);

export const publicExport = auditTalPaSchema.table(
  'public_export',
  {
    id: uuid('id').primaryKey().notNull(),
    period_label: text('period_label').notNull(),
    period_start: timestamp('period_start', { withTimezone: true }).notNull(),
    period_end: timestamp('period_end', { withTimezone: true }).notNull(),
    csv_sha256: text('csv_sha256').notNull(),
    csv_cid: text('csv_cid').notNull(),
    row_count: integer('row_count').notNull(),
    exported_at: timestamp('exported_at', { withTimezone: true }).notNull().defaultNow(),
    audit_event_id: uuid('audit_event_id').notNull(),
    // AUDIT-024: first 8 hex of sha256(salt). Two consecutive exports
    // sharing this fingerprint indicate the operator forgot to rotate
    // the salt — a CI alert + the audit.public_export_salt_collisions
    // view fire on this condition.
    salt_fingerprint: char('salt_fingerprint', { length: 8 }).notNull(),
  },
  (t) => ({
    periodUnique: uniqueIndex('public_export_period_label_unique').on(t.period_label),
  }),
);
