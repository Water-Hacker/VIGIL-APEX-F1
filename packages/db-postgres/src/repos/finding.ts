import { Constants } from '@vigil/shared';
import { and, desc, eq, gte, ne, or, sql } from 'drizzle-orm';

import * as findingSchema from '../schema/finding.js';

import type { Db } from '../client.js';

export class FindingRepo {
  constructor(private readonly db: Db) {}

  async insert(row: typeof findingSchema.finding.$inferInsert): Promise<void> {
    await this.db.insert(findingSchema.finding).values(row);
  }

  async getById(id: string): Promise<typeof findingSchema.finding.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(findingSchema.finding)
      .where(eq(findingSchema.finding.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * List findings strong enough to bring to council. The defaults are
   * imported from @vigil/shared constants, which is the SINGLE SOURCE
   * OF TRUTH (closes FIND-002 from whole-system-audit doc 10).
   *
   * Callers may pass narrower values (e.g. an operator viewing the
   * borderline-investigation queue may want to see posterior >= 0.80),
   * but the DEFAULT is the CONAC delivery cutoff so that any caller
   * that doesn't think about it gets the safest answer.
   */
  async listEscalationCandidates(
    posteriorMin: number = Constants.POSTERIOR_THRESHOLD_CONAC,
    signalCountMin: number = Constants.MIN_SIGNAL_COUNT_CONAC,
    limit = 50,
  ) {
    return this.db
      .select()
      .from(findingSchema.finding)
      .where(
        and(
          eq(findingSchema.finding.state, 'review'),
          gte(findingSchema.finding.posterior, posteriorMin),
          gte(findingSchema.finding.signal_count, signalCountMin),
        ),
      )
      .orderBy(desc(findingSchema.finding.posterior))
      .limit(limit);
  }

  async getSignals(
    findingId: string,
  ): Promise<readonly (typeof findingSchema.signal.$inferSelect)[]> {
    return this.db
      .select()
      .from(findingSchema.signal)
      .where(eq(findingSchema.signal.finding_id, findingId))
      .orderBy(desc(findingSchema.signal.contributed_at));
  }

  async addSignal(row: typeof findingSchema.signal.$inferInsert): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(findingSchema.signal).values(row);
      await tx
        .update(findingSchema.finding)
        .set({
          signal_count: sql`${findingSchema.finding.signal_count} + 1`,
          last_signal_at: new Date(),
        })
        .where(eq(findingSchema.finding.id, row.finding_id));
    });
  }

  async setPosterior(id: string, posterior: number): Promise<void> {
    await this.db
      .update(findingSchema.finding)
      .set({ posterior, last_signal_at: new Date() })
      .where(eq(findingSchema.finding.id, id));
  }

  async setCounterEvidence(id: string, text: string, nextState: string = 'review'): Promise<void> {
    await this.db
      .update(findingSchema.finding)
      .set({ counter_evidence: text, state: nextState })
      .where(eq(findingSchema.finding.id, id));
  }

  async setState(id: string, state: string, closure_reason?: string): Promise<void> {
    await this.db
      .update(findingSchema.finding)
      .set({
        state,
        ...(closure_reason !== undefined && { closure_reason, closed_at: new Date() }),
      })
      .where(eq(findingSchema.finding.id, id));
  }

  /** DECISION-010 — set / refresh the auto-recommended recipient body and
   *  the denormalised primary pattern_id used to derive it. */
  async setRecommendedRecipientBody(
    id: string,
    recommended: string,
    primaryPatternId: string | null,
  ): Promise<void> {
    await this.db
      .update(findingSchema.finding)
      .set({
        recommended_recipient_body: recommended,
        ...(primaryPatternId !== null && { primary_pattern_id: primaryPatternId }),
      })
      .where(eq(findingSchema.finding.id, id));
  }

  /**
   * Prior findings for a given canonical entity — used by worker-pattern's
   * subject loader (Phase A3). A finding is considered "prior" when the
   * entity is either the primary subject or appears in related_entity_ids.
   */
  async listByEntity(
    canonicalId: string,
    opts: { excludeFindingId?: string; limit?: number } = {},
  ): Promise<readonly (typeof findingSchema.finding.$inferSelect)[]> {
    const limit = opts.limit ?? 25;
    const where = opts.excludeFindingId
      ? and(
          or(
            eq(findingSchema.finding.primary_entity_id, canonicalId),
            sql`${canonicalId} = ANY(${findingSchema.finding.related_entity_ids})`,
          ),
          ne(findingSchema.finding.id, opts.excludeFindingId),
        )
      : or(
          eq(findingSchema.finding.primary_entity_id, canonicalId),
          sql`${canonicalId} = ANY(${findingSchema.finding.related_entity_ids})`,
        );
    return this.db
      .select()
      .from(findingSchema.finding)
      .where(where)
      .orderBy(desc(findingSchema.finding.detected_at))
      .limit(limit);
  }
}
