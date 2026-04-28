import { and, desc, eq, gte, sql } from 'drizzle-orm';

import * as findingSchema from '../schema/finding.js';
import type { Db } from '../client.js';

export class FindingRepo {
  constructor(private readonly db: Db) {}

  async insert(row: typeof findingSchema.finding.$inferInsert): Promise<void> {
    await this.db.insert(findingSchema.finding).values(row);
  }

  async getById(id: string): Promise<(typeof findingSchema.finding.$inferSelect) | null> {
    const rows = await this.db.select().from(findingSchema.finding).where(eq(findingSchema.finding.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async listEscalationCandidates(threshold = 0.85, limit = 50) {
    return this.db
      .select()
      .from(findingSchema.finding)
      .where(and(eq(findingSchema.finding.state, 'review'), gte(findingSchema.finding.posterior, threshold)))
      .orderBy(desc(findingSchema.finding.posterior))
      .limit(limit);
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

  async setState(id: string, state: string, closure_reason?: string): Promise<void> {
    await this.db
      .update(findingSchema.finding)
      .set({
        state,
        ...(closure_reason !== undefined && { closure_reason, closed_at: new Date() }),
      })
      .where(eq(findingSchema.finding.id, id));
  }
}
