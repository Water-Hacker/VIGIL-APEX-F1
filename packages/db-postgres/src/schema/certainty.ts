import { sql } from 'drizzle-orm';
import {
  boolean,
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

/**
 * DECISION-011 — Bayesian certainty engine + AI-Safety-Doctrine-v1 schemas.
 * Each schema mirrors the SQL declared in 0009_certainty_engine.sql.
 */

export const certaintySchema = pgSchema('certainty');
export const calibrationDoctrineSchema = pgSchema('calibration');
export const llmSchema = pgSchema('llm');

export const assessment = certaintySchema.table(
  'assessment',
  {
    id: uuid('id').primaryKey().notNull(),
    finding_id: uuid('finding_id').notNull(),
    engine_version: text('engine_version').notNull(),
    prior_probability: numeric('prior_probability', { precision: 6, scale: 5 }).notNull(),
    posterior_probability: numeric('posterior_probability', { precision: 6, scale: 5 }).notNull(),
    independent_source_count: integer('independent_source_count').notNull(),
    tier: text('tier').notNull(),
    hold_reasons: text('hold_reasons').array().notNull().default(sql`ARRAY[]::text[]`),
    adversarial: jsonb('adversarial').notNull(),
    components: jsonb('components').notNull(),
    severity: text('severity').notNull(),
    input_hash: text('input_hash').notNull(),
    prompt_registry_hash: text('prompt_registry_hash').notNull(),
    model_version: text('model_version').notNull(),
    computed_at: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    findingIdx: index('assessment_finding_idx').on(t.finding_id, t.computed_at),
    tierIdx: index('assessment_tier_idx').on(t.tier, t.computed_at),
  }),
);

export const factProvenance = certaintySchema.table(
  'fact_provenance',
  {
    fact_id: text('fact_id').notNull(),
    primary_source_id: text('primary_source_id').notNull(),
    derivation_chain: text('derivation_chain').array().notNull().default(sql`ARRAY[]::text[]`),
    recorded_at: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceIdx: index('fact_provenance_source_idx').on(t.primary_source_id),
  }),
);

export const auditRun = calibrationDoctrineSchema.table(
  'audit_run',
  {
    id: uuid('id').primaryKey().notNull(),
    period_label: text('period_label').notNull(),
    period_start: timestamp('period_start', { withTimezone: true }).notNull(),
    period_end: timestamp('period_end', { withTimezone: true }).notNull(),
    engine_version: text('engine_version').notNull(),
    per_pattern_gap: jsonb('per_pattern_gap').notNull().default(sql`'{}'::jsonb`),
    anchor_audit_event_id: text('anchor_audit_event_id'),
    computed_at: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    signoff_architect: text('signoff_architect'),
    signoff_analyst: text('signoff_analyst'),
    signoff_independent_reviewer: text('signoff_independent_reviewer'),
  },
  (t) => ({
    periodUnique: unique('audit_run_period_unique').on(t.period_label, t.engine_version),
  }),
);

export const reliabilityBand = calibrationDoctrineSchema.table(
  'reliability_band',
  {
    id: uuid('id').primaryKey().notNull(),
    audit_run_id: uuid('audit_run_id').notNull(),
    band_label: text('band_label').notNull(),
    band_min: numeric('band_min', { precision: 6, scale: 5 }).notNull(),
    band_max: numeric('band_max', { precision: 6, scale: 5 }).notNull(),
    predicted_rate: numeric('predicted_rate', { precision: 6, scale: 5 }).notNull(),
    observed_rate: numeric('observed_rate', { precision: 6, scale: 5 }).notNull(),
    finding_count: integer('finding_count').notNull(),
    cleared_count: integer('cleared_count').notNull(),
    confirmed_count: integer('confirmed_count').notNull(),
    calibration_gap: numeric('calibration_gap', { precision: 6, scale: 5 }).notNull(),
  },
  (t) => ({
    auditLabelUnique: unique('reliability_band_audit_label_unique').on(t.audit_run_id, t.band_label),
  }),
);

export const promptTemplate = llmSchema.table(
  'prompt_template',
  {
    id: uuid('id').primaryKey().notNull(),
    name: text('name').notNull(),
    version: text('version').notNull(),
    template_hash: text('template_hash').notNull(),
    registered_at: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    description: text('description').notNull().default(''),
    active: boolean('active').notNull().default(true),
  },
  (t) => ({
    nameVersionUnique: unique('prompt_template_name_version_unique').on(t.name, t.version),
  }),
);

export const callRecord = llmSchema.table('call_record', {
  id: uuid('id').primaryKey().notNull(),
  finding_id: uuid('finding_id'),
  assessment_id: uuid('assessment_id'),
  prompt_name: text('prompt_name').notNull(),
  prompt_version: text('prompt_version').notNull(),
  prompt_template_hash: text('prompt_template_hash').notNull(),
  model_id: text('model_id').notNull(),
  temperature: numeric('temperature', { precision: 4, scale: 3 }).notNull(),
  input_hash: text('input_hash').notNull(),
  output_hash: text('output_hash').notNull(),
  canary_triggered: boolean('canary_triggered').notNull().default(false),
  schema_valid: boolean('schema_valid').notNull().default(true),
  latency_ms: integer('latency_ms').notNull(),
  cost_usd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  called_at: timestamp('called_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verbatimAuditSample = llmSchema.table('verbatim_audit_sample', {
  id: uuid('id').primaryKey().notNull(),
  call_record_id: uuid('call_record_id'),
  finding_id: uuid('finding_id'),
  claim: text('claim').notNull(),
  source_record_id: text('source_record_id').notNull(),
  verbatim_quote: text('verbatim_quote').notNull(),
  match_found: boolean('match_found').notNull(),
  sampled_at: timestamp('sampled_at', { withTimezone: true }).notNull().defaultNow(),
});
