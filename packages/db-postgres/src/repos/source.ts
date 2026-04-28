import { and, eq, sql } from 'drizzle-orm';

import * as sourceSchema from '../schema/source.js';
import type { Db } from '../client.js';

export class SourceRepo {
  constructor(private readonly db: Db) {}

  async insertEvent(row: typeof sourceSchema.events.$inferInsert): Promise<{ inserted: boolean }> {
    // ON CONFLICT DO NOTHING preserves dedup_unique
    const r = await this.db.execute(sql`
      INSERT INTO source.events
        (id, source_id, kind, dedup_key, published_at, observed_at, payload, document_cids, provenance)
      VALUES
        (${row.id}, ${row.source_id}, ${row.kind}, ${row.dedup_key},
         ${row.published_at}, ${row.observed_at}, ${JSON.stringify(row.payload)}::jsonb,
         ${row.document_cids}, ${JSON.stringify(row.provenance)}::jsonb)
      ON CONFLICT (source_id, dedup_key) DO NOTHING
      RETURNING id
    `);
    return { inserted: r.rows.length > 0 };
  }

  async upsertHealth(row: typeof sourceSchema.adapterHealth.$inferInsert): Promise<void> {
    await this.db
      .insert(sourceSchema.adapterHealth)
      .values(row)
      .onConflictDoUpdate({
        target: sourceSchema.adapterHealth.source_id,
        set: {
          status: row.status,
          last_run_at: row.last_run_at,
          last_success_at: row.last_success_at,
          last_error: row.last_error,
          consecutive_failures: row.consecutive_failures,
          rows_in_last_run: row.rows_in_last_run,
          next_scheduled_at: row.next_scheduled_at,
          updated_at: new Date(),
        },
      });
  }

  async getHealth(sourceId: string) {
    const rows = await this.db
      .select()
      .from(sourceSchema.adapterHealth)
      .where(eq(sourceSchema.adapterHealth.source_id, sourceId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getHealthAll() {
    return this.db.select().from(sourceSchema.adapterHealth);
  }

  async insertDocument(row: typeof sourceSchema.documents.$inferInsert): Promise<void> {
    await this.db.insert(sourceSchema.documents).values(row).onConflictDoNothing();
  }

  async getDocumentBySha256(sha256: string) {
    const rows = await this.db
      .select()
      .from(sourceSchema.documents)
      .where(eq(sourceSchema.documents.sha256, sha256))
      .limit(1);
    return rows[0] ?? null;
  }
}
