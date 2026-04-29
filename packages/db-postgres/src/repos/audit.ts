import { eq, sql } from 'drizzle-orm';

import * as auditSchema from '../schema/audit.js';

import type { Db } from '../client.js';
import type { Schemas } from '@vigil/shared';

/**
 * AuditRepo — read-only views over the hash chain. WRITES go through
 * `@vigil/audit-chain HashChain.append()` to ensure prev_hash/body_hash
 * are computed atomically.
 */
export class AuditRepo {
  constructor(private readonly db: Db) {}

  async findBySeq(seq: number): Promise<(typeof auditSchema.actions.$inferSelect) | null> {
    const rows = await this.db
      .select()
      .from(auditSchema.actions)
      .where(eq(auditSchema.actions.seq, seq))
      .limit(1);
    return rows[0] ?? null;
  }

  async findRecent(limit = 100): Promise<(typeof auditSchema.actions.$inferSelect)[]> {
    return this.db.select().from(auditSchema.actions).orderBy(sql`seq DESC`).limit(limit);
  }

  async findByActionAndSubject(
    action: Schemas.AuditAction,
    subjectId: string,
    limit = 50,
  ): Promise<(typeof auditSchema.actions.$inferSelect)[]> {
    return this.db
      .select()
      .from(auditSchema.actions)
      .where(sql`action = ${action} AND subject_id = ${subjectId}`)
      .orderBy(sql`seq DESC`)
      .limit(limit);
  }

  async tipReceivedSinceCount(sinceIso: string): Promise<number> {
    const r = await this.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM audit.actions WHERE action = 'tip.received' AND occurred_at >= ${sinceIso}::timestamptz`,
    );
    return Number((r.rows[0] as { c: number }).c);
  }
}
