import { desc, eq, sql } from 'drizzle-orm';

import * as tipSchema from '../schema/tip.js';
import type { Db } from '../client.js';

export class TipRepo {
  constructor(private readonly db: Db) {}

  async insert(row: typeof tipSchema.tip.$inferInsert): Promise<void> {
    await this.db.insert(tipSchema.tip).values(row);
  }

  async getByRef(ref: string) {
    const rows = await this.db.select().from(tipSchema.tip).where(eq(tipSchema.tip.ref, ref)).limit(1);
    return rows[0] ?? null;
  }

  async listForTriage(limit = 50) {
    return this.db
      .select()
      .from(tipSchema.tip)
      .where(sql`disposition IN ('NEW','IN_TRIAGE')`)
      .orderBy(desc(tipSchema.tip.received_at))
      .limit(limit);
  }

  async setDisposition(id: string, disposition: string, by: string) {
    await this.db
      .update(tipSchema.tip)
      .set({ disposition, triaged_at: new Date(), triaged_by: by })
      .where(eq(tipSchema.tip.id, id));
  }

  async nextRefSeqForYear(year: number): Promise<number> {
    const r = await this.db.execute(sql`
      INSERT INTO tip.tip_sequence (year, next_seq)
        VALUES (${String(year)}, ${'2'})
        ON CONFLICT (year) DO UPDATE
          SET next_seq = (CAST(tip.tip_sequence.next_seq AS BIGINT) + 1)::TEXT
        RETURNING next_seq
    `);
    const v = (r.rows[0] as { next_seq: string }).next_seq;
    return Number(v) - 1; // we incremented; return the value just allocated
  }
}
