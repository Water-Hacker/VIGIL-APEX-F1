import { sql } from 'drizzle-orm';
import {
  bigint,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const auditSchema = pgSchema('audit');

const bytea = customType<{ data: Buffer; driverData: Buffer; notNull: false }>({
  dataType: () => 'bytea',
});

/**
 * audit.actions — hash-chained, tamper-evident.
 *
 * Per W-11: replaces Hyperledger Fabric for the MVP. Verified hourly (CT-01)
 * and anchored to Polygon mainnet hourly (CT-02).
 */
export const actions = auditSchema.table(
  'actions',
  {
    id: uuid('id').primaryKey().notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    subject_kind: text('subject_kind').notNull(),
    subject_id: text('subject_id').notNull(),
    occurred_at: timestamp('occurred_at', { withTimezone: true }).notNull(),
    payload: jsonb('payload').notNull(),
    prev_hash: bytea('prev_hash'),
    body_hash: bytea('body_hash').notNull(),
    inserted_at: timestamp('inserted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    seqUnique: unique('actions_seq_unique').on(t.seq),
    actionIdx: index('actions_action_idx').on(t.action, t.occurred_at.desc()),
    subjectIdx: index('actions_subject_idx').on(t.subject_kind, t.subject_id),
  }),
);

export const anchorCommitment = auditSchema.table('anchor_commitment', {
  id: uuid('id').primaryKey().notNull(),
  audit_event_seq_from: bigint('seq_from', { mode: 'number' }).notNull(),
  audit_event_seq_to: bigint('seq_to', { mode: 'number' }).notNull(),
  root_hash: bytea('root_hash').notNull(),
  committed_at: timestamp('committed_at', { withTimezone: true }).notNull().defaultNow(),
  polygon_tx_hash: text('polygon_tx_hash'),
  polygon_block_number: bigint('polygon_block_number', { mode: 'number' }),
  polygon_confirmed_at: timestamp('polygon_confirmed_at', { withTimezone: true }),
});
