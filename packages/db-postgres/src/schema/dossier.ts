import { sql } from 'drizzle-orm';
import { bigint, integer, jsonb, pgSchema, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

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
    recipient_case_reference: text('recipient_case_reference'),
    manifest_hash: text('manifest_hash'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({ refUnique: unique('dossier_ref_unique').on(t.ref, t.language) }),
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
