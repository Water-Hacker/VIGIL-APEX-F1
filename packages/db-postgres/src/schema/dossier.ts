import { sql } from 'drizzle-orm';
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const dossierSchema = pgSchema('dossier');

export const dossier = dossierSchema.table(
  'dossier',
  {
    id: uuid('id').primaryKey().notNull(),
    ref: text('ref').notNull(),
    finding_id: uuid('finding_id').notNull(),
    language: text('language').notNull(),
    status: text('status').notNull().default('rendered'),
    pdf_sha256: text('pdf_sha256').notNull(),
    pdf_cid: text('pdf_cid'),
    signature_fingerprint: text('signature_fingerprint'),
    signature_at: timestamp('signature_at', { withTimezone: true }),
    rendered_at: timestamp('rendered_at', { withTimezone: true }).notNull().defaultNow(),
    delivered_at: timestamp('delivered_at', { withTimezone: true }),
    acknowledged_at: timestamp('acknowledged_at', { withTimezone: true }),
    // DECISION-010: per-finding routing. Default 'CONAC' for back-compat with
    // pre-DECISION-010 rows. Worker-conac-sftp dispatches per-body off this.
    recipient_body_name: text('recipient_body_name').notNull().default('CONAC'),
    recipient_case_reference: text('recipient_case_reference'),
    manifest_hash: text('manifest_hash'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    refUnique: unique('dossier_ref_unique').on(t.ref, t.language),
    recipientIdx: index('dossier_recipient_idx').on(t.recipient_body_name, t.status),
  }),
);

export const referral = dossierSchema.table('referral', {
  id: uuid('id').primaryKey().notNull(),
  dossier_id: uuid('dossier_id').notNull(),
  channel: text('channel').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  last_attempt_at: timestamp('last_attempt_at', { withTimezone: true }),
  ack_received_at: timestamp('ack_received_at', { withTimezone: true }),
  ack_payload: jsonb('ack_payload'),
  format_adapter_version: text('format_adapter_version').notNull().default('v1'),
});

export const dossierSequence = dossierSchema.table('dossier_sequence', {
  year: integer('year').primaryKey(),
  next_seq: bigint('next_seq', { mode: 'number' }).notNull().default(1),
});

/**
 * DECISION-010 — every recipient-body change for a finding is logged here.
 * The latest row per finding wins. Used by worker-governance to determine
 * what body to render the dossier for.
 */
export const routingDecision = dossierSchema.table(
  'routing_decision',
  {
    id: uuid('id').primaryKey().notNull(),
    finding_id: uuid('finding_id').notNull(),
    recipient_body_name: text('recipient_body_name').notNull(),
    source: text('source').notNull(), // 'auto' | 'operator' | 'council'
    decided_by: text('decided_by').notNull(),
    decided_at: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    rationale: text('rationale').notNull(),
  },
  (t) => ({
    findingIdx: index('routing_decision_finding_idx').on(t.finding_id, t.decided_at),
  }),
);

/**
 * DECISION-010 — tracks satellite-verification requests per project so the
 * trigger adapter is idempotent. One row per (project_id, contract_window).
 */
export const satelliteRequest = dossierSchema.table(
  'satellite_request',
  {
    id: uuid('id').primaryKey().notNull(),
    project_id: uuid('project_id').notNull(),
    contract_start: date('contract_start').notNull(),
    contract_end: date('contract_end').notNull(),
    requested_at: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    request_id: text('request_id').notNull(),
    status: text('status').notNull().default('queued'), // 'queued' | 'in_progress' | 'completed' | 'failed'
    provider_used: text('provider_used'),
    scene_count: integer('scene_count'),
    activity_score: numeric('activity_score', { precision: 5, scale: 4 }),
    cost_usd: numeric('cost_usd', { precision: 10, scale: 4 }).default('0'),
    error_message: text('error_message'),
    result_cid: text('result_cid'),
  },
  (t) => ({
    projectWindowUnique: unique('satellite_request_project_window_unique').on(
      t.project_id,
      t.contract_start,
      t.contract_end,
    ),
    statusIdx: index('satellite_request_status_idx').on(t.status, t.requested_at),
  }),
);
