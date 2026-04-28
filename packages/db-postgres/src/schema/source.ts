import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * `source` schema — adapter outputs.
 *
 * SRD §07.4 (Schema source):
 *   source.events         — every structured event the adapter emits
 *   source.documents      — fetched binary artefacts (deduped by sha256)
 *   source.proxy_pool     — proxy inventory + cooldowns
 *   source.adapter_health — periodic health snapshots
 */

export const sourceSchema = pgSchema('source');

export const events = sourceSchema.table(
  'events',
  {
    id: uuid('id').primaryKey().notNull(),
    source_id: text('source_id').notNull(),
    kind: text('kind').notNull(),
    dedup_key: text('dedup_key').notNull(),
    published_at: timestamp('published_at', { withTimezone: true }),
    observed_at: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb('payload').notNull(),
    document_cids: text('document_cids').array().notNull().default(sql`ARRAY[]::text[]`),
    provenance: jsonb('provenance').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dedupUnique: unique('events_dedup_unique').on(t.source_id, t.dedup_key),
    sourceIdx: index('events_source_idx').on(t.source_id, t.observed_at.desc()),
    kindIdx: index('events_kind_idx').on(t.kind),
  }),
);

export const documents = sourceSchema.table(
  'documents',
  {
    id: uuid('id').primaryKey().notNull(),
    cid: text('cid').notNull(),
    source_id: text('source_id').notNull(),
    kind: text('kind').notNull(),
    mime: text('mime').notNull(),
    language: text('language').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    source_url: text('source_url'),
    fetched_at: timestamp('fetched_at', { withTimezone: true }).notNull(),
    ocr_engine: text('ocr_engine').notNull().default('none'),
    ocr_confidence: text('ocr_confidence'),
    text_extract_chars: integer('text_extract_chars'),
    pinned_at_ipfs: boolean('pinned_at_ipfs').notNull().default(false),
    mirrored_to_synology: boolean('mirrored_to_synology').notNull().default(false),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    sha256Unique: unique('documents_sha256_unique').on(t.sha256),
    cidIdx: index('documents_cid_idx').on(t.cid),
  }),
);

export const proxyPool = sourceSchema.table('proxy_pool', {
  id: uuid('id').primaryKey().notNull(),
  provider: text('provider').notNull(), // hetzner-dc | bright-data | tor
  endpoint: text('endpoint').notNull(),
  region: text('region'),
  active: boolean('active').notNull().default(true),
  cooldown_until: timestamp('cooldown_until', { withTimezone: true }),
  failures_24h: integer('failures_24h').notNull().default(0),
  last_used_at: timestamp('last_used_at', { withTimezone: true }),
});

export const adapterHealth = sourceSchema.table('adapter_health', {
  source_id: text('source_id').primaryKey(),
  status: text('status').notNull(),
  last_run_at: timestamp('last_run_at', { withTimezone: true }),
  last_success_at: timestamp('last_success_at', { withTimezone: true }),
  last_error: text('last_error'),
  consecutive_failures: integer('consecutive_failures').notNull().default(0),
  rows_in_last_run: integer('rows_in_last_run'),
  next_scheduled_at: timestamp('next_scheduled_at', { withTimezone: true }),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const robots = sourceSchema.table('robots', {
  source_id: text('source_id').primaryKey(),
  user_agent: text('user_agent').notNull(),
  body: text('body').notNull(),
  fetched_at: timestamp('fetched_at', { withTimezone: true }).notNull(),
});

export const deadLetter = sourceSchema.table('dead_letter', {
  id: uuid('id').primaryKey().notNull(),
  source_id: text('source_id'),
  worker: text('worker').notNull(),
  error_class: text('error_class').notNull(),
  payload: jsonb('payload').notNull(),
  reason: text('reason').notNull(),
  retry_count: integer('retry_count').notNull().default(0),
  first_seen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  last_attempt: timestamp('last_attempt', { withTimezone: true }).notNull().defaultNow(),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  resolved_reason: text('resolved_reason'),
});
