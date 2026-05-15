import { desc, eq, sql } from 'drizzle-orm';

import * as pdSchema from '../schema/pattern-discovery.js';

import type { Db } from '../client.js';

export type CandidateStatus = 'awaiting_curation' | 'promoted' | 'dismissed' | 'merged';
export type CandidateKind =
  | 'stellar_degree'
  | 'tight_community_outflow'
  | 'cycle_3_to_6'
  | 'sudden_mass_creation'
  | 'burst_then_quiet'
  | 'triangle_bridge';

/**
 * PatternDiscoveryRepo — read/write for FRONTIER-AUDIT E1.1 third
 * element's discovery candidate table.
 *
 * `upsertCandidate` is the only write path used by the worker. On
 * dedup_key conflict it updates `strength` + `last_seen_at` + `evidence`
 * but does NOT clobber a curated status — once an architect dismisses
 * a candidate, the next daily run records it as "still seen" without
 * resurrecting it.
 */
export class PatternDiscoveryRepo {
  constructor(private readonly db: Db) {}

  async upsertCandidate(
    row: typeof pdSchema.patternDiscoveryCandidate.$inferInsert,
  ): Promise<{ inserted: boolean }> {
    const result = await this.db
      .insert(pdSchema.patternDiscoveryCandidate)
      .values(row)
      .onConflictDoUpdate({
        target: pdSchema.patternDiscoveryCandidate.dedup_key,
        set: {
          strength: row.strength,
          last_seen_at: sql`now()`,
          evidence: row.evidence,
          rationale: row.rationale,
        },
        setWhere: sql`pattern_discovery.candidate.status = 'awaiting_curation'`,
      })
      .returning({ id: pdSchema.patternDiscoveryCandidate.id });
    return { inserted: result.length > 0 };
  }

  async listAwaitingCuration(limit = 50) {
    return this.db
      .select()
      .from(pdSchema.patternDiscoveryCandidate)
      .where(eq(pdSchema.patternDiscoveryCandidate.status, 'awaiting_curation'))
      .orderBy(desc(pdSchema.patternDiscoveryCandidate.last_seen_at))
      .limit(limit);
  }

  async setCuration(input: {
    readonly id: string;
    readonly status: Extract<CandidateStatus, 'promoted' | 'dismissed' | 'merged'>;
    readonly curated_by: string;
    readonly decision: string;
    readonly notes?: string;
  }): Promise<void> {
    await this.db
      .update(pdSchema.patternDiscoveryCandidate)
      .set({
        status: input.status,
        curated_at: new Date(),
        curated_by: input.curated_by,
        curation_decision: input.decision,
        curation_notes: input.notes ?? null,
      })
      .where(eq(pdSchema.patternDiscoveryCandidate.id, input.id));
  }
}
