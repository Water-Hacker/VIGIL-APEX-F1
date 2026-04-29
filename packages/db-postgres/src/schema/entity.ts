import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const entitySchema = pgSchema('entity');

export const canonical = entitySchema.table(
  'canonical',
  {
    id: uuid('id').primaryKey().notNull(),
    kind: text('kind').notNull(),
    display_name: text('display_name').notNull(),
    rccm_number: text('rccm_number'),
    niu: text('niu'),
    jurisdiction: text('jurisdiction'),
    region: text('region'),
    eth_address: text('eth_address'),
    is_pep: boolean('is_pep').notNull().default(false),
    is_sanctioned: boolean('is_sanctioned').notNull().default(false),
    sanctioned_lists: text('sanctioned_lists').array().notNull().default(sql`ARRAY[]::text[]`),
    first_seen: timestamp('first_seen', { withTimezone: true }).notNull(),
    last_seen: timestamp('last_seen', { withTimezone: true }).notNull(),
    resolution_confidence: doublePrecision('resolution_confidence').notNull(),
    resolved_by: text('resolved_by').notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    rccmIdx: index('canonical_rccm_idx').on(t.rccm_number),
    pepIdx: index('canonical_pep_idx').on(t.is_pep, t.is_sanctioned),
    nameIdx: index('canonical_name_trgm').using(
      'gin',
      sql`${t.display_name} gin_trgm_ops`,
    ),
  }),
);

export const alias = entitySchema.table(
  'alias',
  {
    id: uuid('id').primaryKey().notNull(),
    canonical_id: uuid('canonical_id').notNull(),
    alias: text('alias').notNull(),
    source_id: text('source_id').notNull(),
    language: text('language').notNull(),
    first_seen: timestamp('first_seen', { withTimezone: true }).notNull(),
  },
  (t) => ({
    canonicalIdx: index('alias_canonical_idx').on(t.canonical_id),
    aliasIdx: index('alias_alias_idx').on(t.alias),
    aliasUnique: unique('alias_unique').on(t.canonical_id, t.alias, t.source_id),
  }),
);

export const relationship = entitySchema.table(
  'relationship',
  {
    id: uuid('id').primaryKey().notNull(),
    kind: text('kind').notNull(),
    from_canonical_id: uuid('from_canonical_id').notNull(),
    to_canonical_id: uuid('to_canonical_id').notNull(),
    evidence_strength: doublePrecision('evidence_strength').notNull(),
    source_event_ids: uuid('source_event_ids').array().notNull(),
    first_seen: timestamp('first_seen', { withTimezone: true }).notNull(),
    last_seen: timestamp('last_seen', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    fromIdx: index('relationship_from_idx').on(t.from_canonical_id),
    toIdx: index('relationship_to_idx').on(t.to_canonical_id),
    kindIdx: index('relationship_kind_idx').on(t.kind),
  }),
);

export const erReviewQueue = entitySchema.table('er_review_queue', {
  id: uuid('id').primaryKey().notNull(),
  candidate_canonical_a: uuid('candidate_a').notNull(),
  candidate_canonical_b: uuid('candidate_b').notNull(),
  similarity: doublePrecision('similarity').notNull(),
  proposed_action: text('proposed_action').notNull(), // merge | split | keep
  rationale: text('rationale').notNull(),
  decided_at: timestamp('decided_at', { withTimezone: true }),
  decided_by: text('decided_by'),
  decision: text('decision'),
});
