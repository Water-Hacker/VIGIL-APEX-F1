import { and, desc, eq, sql } from 'drizzle-orm';

import { clampRepoLimit } from '../limit-cap.js';
import * as cs from '../schema/certainty.js';

import type { Db } from '../client.js';

/**
 * DECISION-011 — repos for the certainty / calibration / llm schemas.
 *
 * The `assessment` repo is the canonical persistence for the engine's
 * outputs. The `callRecord` repo gives every Claude call a tamper-evident
 * paper trail. The `verbatimAudit` repo stores the daily 5% sampler.
 */

export class CertaintyRepo {
  constructor(private readonly db: Db) {}

  async upsertAssessment(row: typeof cs.assessment.$inferInsert): Promise<void> {
    await this.db
      .insert(cs.assessment)
      .values(row)
      .onConflictDoNothing({ target: cs.assessment.id });
  }

  async latestForFinding(findingId: string): Promise<typeof cs.assessment.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(cs.assessment)
      .where(eq(cs.assessment.finding_id, findingId))
      .orderBy(desc(cs.assessment.computed_at))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByTier(
    tier: 'action_queue' | 'investigation_queue' | 'log_only',
    limit = 100,
  ): Promise<readonly (typeof cs.assessment.$inferSelect)[]> {
    return this.db
      .select()
      .from(cs.assessment)
      .where(eq(cs.assessment.tier, tier))
      .orderBy(desc(cs.assessment.computed_at))
      .limit(clampRepoLimit(limit));
  }
}

export class FactProvenanceRepo {
  constructor(private readonly db: Db) {}

  async insertRoot(row: typeof cs.factProvenance.$inferInsert): Promise<void> {
    await this.db.insert(cs.factProvenance).values(row).onConflictDoNothing();
  }

  /** All primary-source roots for a fact id. */
  async rootsFor(factId: string): Promise<readonly string[]> {
    const r = await this.db
      .select({ src: cs.factProvenance.primary_source_id })
      .from(cs.factProvenance)
      .where(eq(cs.factProvenance.fact_id, factId));
    return r.map((row) => row.src);
  }
}

export class PromptTemplateRepo {
  constructor(private readonly db: Db) {}

  async upsert(row: typeof cs.promptTemplate.$inferInsert): Promise<void> {
    await this.db
      .insert(cs.promptTemplate)
      .values(row)
      .onConflictDoUpdate({
        target: [cs.promptTemplate.name, cs.promptTemplate.version],
        set: {
          template_hash: row.template_hash,
          description: row.description ?? '',
          ...(row.active !== undefined && { active: row.active }),
        },
      });
  }

  async getActive(name: string): Promise<typeof cs.promptTemplate.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(cs.promptTemplate)
      .where(and(eq(cs.promptTemplate.name, name), eq(cs.promptTemplate.active, true)))
      .orderBy(desc(cs.promptTemplate.registered_at))
      .limit(1);
    return rows[0] ?? null;
  }
}

export class CallRecordRepo {
  constructor(private readonly db: Db) {}

  async record(row: typeof cs.callRecord.$inferInsert): Promise<void> {
    await this.db.insert(cs.callRecord).values(row);
  }

  /** Total canary-triggered + schema-invalid count in a recent window —
   *  surfaced on the AI-Safety dashboard. */
  async healthSnapshot(sinceIso: string): Promise<{
    totalCalls: number;
    canaryTriggered: number;
    schemaInvalid: number;
  }> {
    const r = await this.db.execute<{
      total_calls: number | string;
      canary_triggered: number | string;
      schema_invalid: number | string;
    }>(sql`
      SELECT COUNT(*) AS total_calls,
             COUNT(*) FILTER (WHERE canary_triggered) AS canary_triggered,
             COUNT(*) FILTER (WHERE NOT schema_valid)  AS schema_invalid
        FROM llm.call_record
       WHERE called_at >= ${sinceIso}::timestamptz
    `);
    const row = r.rows[0];
    return {
      totalCalls: Number(row?.total_calls ?? 0),
      canaryTriggered: Number(row?.canary_triggered ?? 0),
      schemaInvalid: Number(row?.schema_invalid ?? 0),
    };
  }
}

export class VerbatimAuditRepo {
  constructor(private readonly db: Db) {}

  async record(row: typeof cs.verbatimAuditSample.$inferInsert): Promise<void> {
    await this.db.insert(cs.verbatimAuditSample).values(row);
  }

  /** Hallucination rate over a recent window (1 - matches/total). */
  async hallucinationRate(sinceIso: string): Promise<{ rate: number; sampled: number }> {
    const r = await this.db.execute<{
      sampled: number | string;
      matches: number | string;
    }>(sql`
      SELECT COUNT(*) AS sampled,
             COUNT(*) FILTER (WHERE match_found) AS matches
        FROM llm.verbatim_audit_sample
       WHERE sampled_at >= ${sinceIso}::timestamptz
    `);
    const row = r.rows[0];
    const sampled = Number(row?.sampled ?? 0);
    const matches = Number(row?.matches ?? 0);
    return {
      sampled,
      rate: sampled === 0 ? 0 : 1 - matches / sampled,
    };
  }
}

export class CalibrationAuditRepo {
  constructor(private readonly db: Db) {}

  async createRun(row: typeof cs.auditRun.$inferInsert): Promise<void> {
    await this.db.insert(cs.auditRun).values(row).onConflictDoNothing();
  }

  async recordBand(row: typeof cs.reliabilityBand.$inferInsert): Promise<void> {
    await this.db
      .insert(cs.reliabilityBand)
      .values(row)
      .onConflictDoUpdate({
        target: [cs.reliabilityBand.audit_run_id, cs.reliabilityBand.band_label],
        set: {
          predicted_rate: row.predicted_rate,
          observed_rate: row.observed_rate,
          finding_count: row.finding_count,
          cleared_count: row.cleared_count,
          confirmed_count: row.confirmed_count,
          calibration_gap: row.calibration_gap,
        },
      });
  }

  async listRuns(limit = 12): Promise<readonly (typeof cs.auditRun.$inferSelect)[]> {
    return this.db
      .select()
      .from(cs.auditRun)
      .orderBy(desc(cs.auditRun.period_start))
      .limit(clampRepoLimit(limit));
  }

  async listBands(
    auditRunId: string,
  ): Promise<readonly (typeof cs.reliabilityBand.$inferSelect)[]> {
    return this.db
      .select()
      .from(cs.reliabilityBand)
      .where(eq(cs.reliabilityBand.audit_run_id, auditRunId))
      .orderBy(cs.reliabilityBand.band_min);
  }
}
