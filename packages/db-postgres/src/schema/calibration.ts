import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const calibrationSchema = pgSchema('calibration');

/**
 * calibration.entry — one historical case. Row-Level-Security restricts
 * tip_handlers from reading; auditors get read-only; public sees aggregates.
 */

export const entry = calibrationSchema.table(
  'entry',
  {
    id: uuid('id').primaryKey().notNull(),
    recorded_at: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    pattern_id: text('pattern_id').notNull(),
    finding_id: uuid('finding_id').notNull(),
    case_label: text('case_label').notNull(),
    case_year: integer('case_year').notNull(),
    region: text('region'),
    amount_xaf: bigint('amount_xaf', { mode: 'number' }),
    posterior_at_review: doublePrecision('posterior_at_review').notNull(),
    severity_at_review: text('severity_at_review').notNull(),
    ground_truth: text('ground_truth').notNull().default('pending'),
    ground_truth_recorded_by: text('ground_truth_recorded_by').notNull(),
    ground_truth_evidence: jsonb('ground_truth_evidence').notNull(),
    closure_reason: text('closure_reason'),
    notes: text('notes').notNull().default(''),
    redacted: boolean('redacted').notNull().default(false),
  },
  (t) => ({
    patternIdx: index('entry_pattern_idx').on(t.pattern_id),
    truthIdx: index('entry_truth_idx').on(t.ground_truth, t.recorded_at.desc()),
  }),
);

export const report = calibrationSchema.table('report', {
  id: uuid('id').primaryKey().notNull(),
  computed_at: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  window_days: integer('window_days').notNull(),
  total_entries: integer('total_entries').notNull(),
  graded_entries: integer('graded_entries').notNull(),
  ece_overall: doublePrecision('ece_overall').notNull(),
  brier_overall: doublePrecision('brier_overall').notNull(),
  per_pattern: jsonb('per_pattern').notNull(),
});
