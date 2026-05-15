import { repoCasConflictTotal } from '@vigil/observability';
import { Constants } from '@vigil/shared';
import { and, desc, eq, gte, ne, or, sql } from 'drizzle-orm';

import * as findingSchema from '../schema/finding.js';

import type { Db } from '../client.js';

/**
 * Hardening mode 2.8 — typed CAS conflict for repo setters that accept
 * `expectedRevision`. Callers MUST catch this and either retry with a
 * fresh read or fail the operation; never assume the write succeeded.
 *
 * The metric `vigil_repo_cas_conflict_total{repo,fn}` is incremented on
 * every throw so operators can see contention pressure even when callers
 * retry silently.
 */
export class CasConflictError extends Error {
  readonly code = 'CAS_CONFLICT';

  constructor(
    public readonly repo: string,
    public readonly fn: string,
    public readonly id: string,
    public readonly expectedRevision: number,
  ) {
    super(
      `CAS conflict in ${repo}.${fn}(${id}): expected revision ${expectedRevision} ` +
        `but row revision differs (concurrent writer detected). Caller must refetch and retry.`,
    );
    this.name = 'CasConflictError';
  }
}

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

  /**
   * Hardening mode 2.8 — all setters now accept an OPTIONAL
   * `expectedRevision` and increment the `revision` column on every
   * write. Callers that pass `expectedRevision` get CAS semantics:
   * mismatch throws `CasConflictError`, no write happens. Callers
   * that omit it continue with last-write-wins (backward compat).
   *
   * Returns the new revision so the caller can chain another CAS write.
   */
  async setPosterior(id: string, posterior: number, expectedRevision?: number): Promise<number> {
    return this.casUpdate('setPosterior', id, expectedRevision, {
      posterior,
      last_signal_at: new Date(),
    });
  }

  async setCounterEvidence(
    id: string,
    text: string,
    nextState: string = 'review',
    expectedRevision?: number,
  ): Promise<number> {
    return this.casUpdate('setCounterEvidence', id, expectedRevision, {
      counter_evidence: text,
      state: nextState,
    });
  }

  async setState(
    id: string,
    state: string,
    closure_reason?: string,
    expectedRevision?: number,
  ): Promise<number> {
    return this.casUpdate('setState', id, expectedRevision, {
      state,
      ...(closure_reason !== undefined && { closure_reason, closed_at: new Date() }),
    });
  }

  /** DECISION-010 — set / refresh the auto-recommended recipient body and
   *  the denormalised primary pattern_id used to derive it. */
  async setRecommendedRecipientBody(
    id: string,
    recommended: string,
    primaryPatternId: string | null,
    expectedRevision?: number,
  ): Promise<number> {
    return this.casUpdate('setRecommendedRecipientBody', id, expectedRevision, {
      recommended_recipient_body: recommended,
      ...(primaryPatternId !== null && { primary_pattern_id: primaryPatternId }),
    });
  }

  /**
   * Internal CAS-aware update helper. ALL setter mutations flow through
   * here so the revision-increment + CAS-check contract is uniform.
   */
  private async casUpdate(
    fn: string,
    id: string,
    expectedRevision: number | undefined,
    columns: Record<string, unknown>,
  ): Promise<number> {
    const whereExpectedRevision =
      expectedRevision !== undefined
        ? and(
            eq(findingSchema.finding.id, id),
            eq(findingSchema.finding.revision, expectedRevision),
          )
        : eq(findingSchema.finding.id, id);

    const result = await this.db
      .update(findingSchema.finding)
      .set({
        ...columns,
        revision: sql`${findingSchema.finding.revision} + 1`,
      })
      .where(whereExpectedRevision)
      .returning({ revision: findingSchema.finding.revision });

    if (expectedRevision !== undefined && result.length === 0) {
      repoCasConflictTotal.inc({ repo: 'FindingRepo', fn });
      throw new CasConflictError('FindingRepo', fn, id, expectedRevision);
    }
    // result.length === 0 with no expectedRevision: row doesn't exist.
    // Preserve legacy behaviour (silent no-op) — changing this would
    // break callers that intentionally race on a finding being created.
    // Callers that care can pass expectedRevision and get CAS semantics.
    return result[0]?.revision ?? -1;
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
