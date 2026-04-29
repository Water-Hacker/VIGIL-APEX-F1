import { sql } from 'drizzle-orm';
import { customType, index, pgSchema, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const tipSchema = pgSchema('tip');

const bytea = customType<{ data: Buffer; driverData: Buffer; notNull: false }>({
  dataType: () => 'bytea',
});

/**
 * tip.tip — anonymous citizen submissions. SRD §28.
 *
 * Body and contact ciphertexts NEVER stored as plain JSON. The dashboard
 * decryption ceremony (3-of-5 council quorum for sensitive tips) is recorded
 * via audit.actions; the decrypted plaintext is held in memory only and
 * paraphrased before any downstream worker sees it (EXEC §18.2).
 */

export const tip = tipSchema.table(
  'tip',
  {
    id: uuid('id').primaryKey().notNull(),
    ref: text('ref').notNull(),
    disposition: text('disposition').notNull().default('NEW'),
    body_ciphertext: bytea('body_ciphertext').notNull(),
    contact_ciphertext: bytea('contact_ciphertext'),
    attachment_cids: text('attachment_cids').array().notNull().default(sql`ARRAY[]::text[]`),
    topic_hint: text('topic_hint'),
    region: text('region'),
    received_at: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    triaged_at: timestamp('triaged_at', { withTimezone: true }),
    triaged_by: text('triaged_by'),
    promoted_finding_id: uuid('promoted_finding_id'),
    triage_notes_ciphertext: bytea('triage_notes_ciphertext'),
  },
  (t) => ({
    refUnique: unique('tip_ref_unique').on(t.ref),
    dispositionIdx: index('tip_disposition_idx').on(t.disposition, t.received_at.desc()),
  }),
);

export const tipSequence = tipSchema.table('tip_sequence', {
  year: text('year').primaryKey(),
  next_seq: text('next_seq').notNull(),
});
