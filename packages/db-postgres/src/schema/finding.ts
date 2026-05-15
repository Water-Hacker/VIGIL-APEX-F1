import { sql } from 'drizzle-orm';
import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const findingSchema = pgSchema('finding');

export const finding = findingSchema.table(
  'finding',
  {
    id: uuid('id').primaryKey().notNull(),
    state: text('state').notNull().default('detected'),
    primary_entity_id: uuid('primary_entity_id'),
    related_entity_ids: uuid('related_entity_ids')
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    amount_xaf: bigint('amount_xaf', { mode: 'number' }),
    region: text('region'),
    severity: text('severity').notNull().default('low'),
    posterior: doublePrecision('posterior'),
    signal_count: integer('signal_count').notNull().default(0),
    title_fr: text('title_fr').notNull(),
    title_en: text('title_en').notNull(),
    summary_fr: text('summary_fr').notNull(),
    summary_en: text('summary_en').notNull(),
    counter_evidence: text('counter_evidence'),
    detected_at: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    last_signal_at: timestamp('last_signal_at', { withTimezone: true }).notNull().defaultNow(),
    council_proposal_index: text('council_proposal_index'),
    council_voted_at: timestamp('council_voted_at', { withTimezone: true }),
    council_yes_votes: integer('council_yes_votes').notNull().default(0),
    council_no_votes: integer('council_no_votes').notNull().default(0),
    council_recused_addresses: text('council_recused_addresses')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    closed_at: timestamp('closed_at', { withTimezone: true }),
    closure_reason: text('closure_reason'),
    // DECISION-010
    recommended_recipient_body: text('recommended_recipient_body'),
    primary_pattern_id: text('primary_pattern_id'),
    // Hardening mode 2.8 — optimistic-lock counter for setPosterior /
    // setState / setCounterEvidence / setRecommendedRecipientBody.
    // See migration 0017_finding_revision.sql for rationale.
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  },
  (t) => ({
    stateIdx: index('finding_state_idx').on(t.state),
    posteriorIdx: index('finding_posterior_idx').on(t.posterior),
    primaryEntityIdx: index('finding_primary_entity_idx').on(t.primary_entity_id),
    severityIdx: index('finding_severity_idx').on(t.severity, t.detected_at.desc()),
  }),
);

export const signal = findingSchema.table(
  'signal',
  {
    id: uuid('id').primaryKey().notNull(),
    finding_id: uuid('finding_id').notNull(),
    source: text('source').notNull(), // pattern | tip | satellite | corroboration | manual
    pattern_id: text('pattern_id'),
    strength: doublePrecision('strength').notNull(),
    prior: doublePrecision('prior').notNull(),
    weight: doublePrecision('weight').notNull(),
    evidence_event_ids: uuid('evidence_event_ids').array().notNull(),
    evidence_document_cids: text('evidence_document_cids').array().notNull(),
    contributed_at: timestamp('contributed_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => ({
    findingIdx: index('signal_finding_idx').on(t.finding_id),
    patternIdx: index('signal_pattern_idx').on(t.pattern_id),
  }),
);
