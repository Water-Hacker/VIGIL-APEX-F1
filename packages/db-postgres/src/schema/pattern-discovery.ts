import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const patternDiscoverySchema = pgSchema('pattern_discovery');

/**
 * FRONTIER-AUDIT E1.1 third element — discovery candidate.
 *
 * One row per detected graph anomaly. worker-pattern-discovery writes
 * here daily after running the 6 deterministic detectors over a Neo4j
 * snapshot. Architect / auditor curates via the dashboard's discovery
 * queue (route to be added under /audit/discovery-queue, gated auditor
 * + architect via middleware).
 *
 * The unique constraint on `dedup_key` makes the daily loop idempotent
 * — a recurring anomaly updates `last_seen_at` rather than producing a
 * duplicate row.
 */
export const patternDiscoveryCandidate = patternDiscoverySchema.table(
  'candidate',
  {
    id: uuid('id').primaryKey().notNull(),
    dedup_key: text('dedup_key').notNull(),
    kind: text('kind').notNull(),
    strength: numeric('strength', { precision: 5, scale: 4 }).notNull(),
    entity_ids_involved: text('entity_ids_involved')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    rationale: text('rationale').notNull(),
    evidence: jsonb('evidence')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('awaiting_curation'),
    first_seen_at: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    last_seen_at: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    curated_at: timestamp('curated_at', { withTimezone: true }),
    curated_by: text('curated_by'),
    curation_decision: text('curation_decision'),
    curation_notes: text('curation_notes'),
  },
  (t) => ({
    dedupUnique: unique('candidate_dedup_unique').on(t.dedup_key),
    statusIdx: index('candidate_status_idx').on(t.status, t.last_seen_at.desc()),
    kindIdx: index('candidate_kind_idx').on(t.kind, t.strength.desc()),
  }),
);
