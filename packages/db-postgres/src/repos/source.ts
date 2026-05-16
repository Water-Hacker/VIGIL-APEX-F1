import { eq, inArray, sql } from 'drizzle-orm';

import * as sourceSchema from '../schema/source.js';

import type { Db } from '../client.js';

// Tier-28 audit closure: per-call bulk-id cap. See getEventsByIds
// for rationale. Public-readonly so callers can size their chunking
// off the same constant.
export const SOURCE_REPO_MAX_BULK_IDS = 1000;

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
          updated_at: new Date(),
          ...(row.last_run_at !== undefined && { last_run_at: row.last_run_at }),
          ...(row.last_success_at !== undefined && { last_success_at: row.last_success_at }),
          ...(row.last_error !== undefined && { last_error: row.last_error }),
          ...(row.consecutive_failures !== undefined && {
            consecutive_failures: row.consecutive_failures,
          }),
          ...(row.rows_in_last_run !== undefined && { rows_in_last_run: row.rows_in_last_run }),
          ...(row.next_scheduled_at !== undefined && { next_scheduled_at: row.next_scheduled_at }),
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

  /**
   * Bulk read by id. Tier-28 audit closure: cap the input array to
   * MAX_BULK_IDS. The node-postgres driver has a hard ceiling around
   * 32k parameter bindings per query; beyond that the call fails with
   * an opaque "bind message has X parameter formats but Y parameters"
   * 500. We refuse at MAX_BULK_IDS = 1000 so the caller hits a clear
   * error and learns to chunk the lookup. T23 worker-pattern caps
   * its own payload at 256 ids; other call sites benefit from the
   * symmetric defence here.
   */
  async getEventsByIds(
    ids: readonly string[],
  ): Promise<readonly (typeof sourceSchema.events.$inferSelect)[]> {
    if (ids.length === 0) return [];
    if (ids.length > SOURCE_REPO_MAX_BULK_IDS) {
      throw new Error(
        `getEventsByIds: received ${ids.length} ids, cap is ${SOURCE_REPO_MAX_BULK_IDS}; caller must chunk`,
      );
    }
    return this.db
      .select()
      .from(sourceSchema.events)
      .where(inArray(sourceSchema.events.id, ids as string[]));
  }

  async getRecentEventsForSources(
    sourceIds: readonly string[],
    limit = 200,
  ): Promise<readonly (typeof sourceSchema.events.$inferSelect)[]> {
    if (sourceIds.length === 0) return [];
    return this.db
      .select()
      .from(sourceSchema.events)
      .where(inArray(sourceSchema.events.source_id, sourceIds as string[]))
      .orderBy(sql`${sourceSchema.events.observed_at} DESC`)
      .limit(limit);
  }

  /**
   * Merge `additions` into `source.events.payload` for the named event.
   * Top-level keys in `additions` win over existing keys at the same path.
   * Nested objects are NOT deep-merged — replace the whole subtree if you
   * need to update one nested key. The extraction worker uses this to
   * write structured fields (bidder_count, procurement_method, etc.) plus
   * `_extraction_provenance` back to the event row.
   *
   * Returns true if a row was updated, false if no event with `id` exists.
   *
   * Concurrency: the merge is done in a single SQL `UPDATE … SET payload =
   * payload || $merge` so two extractor instances writing different keys
   * cannot lose each other's writes (Postgres jsonb concat is atomic).
   * Last-writer-wins on the same key.
   */
  async mergeEventPayload(
    id: string,
    additions: Record<string, unknown>,
  ): Promise<{ updated: boolean }> {
    const r = await this.db.execute(sql`
      UPDATE source.events
      SET payload = payload || ${JSON.stringify(additions)}::jsonb
      WHERE id = ${id}
      RETURNING id
    `);
    return { updated: r.rows.length > 0 };
  }

  /** Single-row read by id; returns null if not found. */
  async getEventById(id: string): Promise<typeof sourceSchema.events.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(sourceSchema.events)
      .where(eq(sourceSchema.events.id, id))
      .limit(1);
    return rows[0] ?? null;
  }
}
