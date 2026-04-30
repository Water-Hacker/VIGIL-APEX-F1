import { eq, inArray, or, sql } from 'drizzle-orm';

import * as entitySchema from '../schema/entity.js';

import type { Db } from '../client.js';

/**
 * EntityRepo — read access to entity.canonical / entity.relationship.
 *
 * worker-pattern is the primary consumer (subject loader). All reads go
 * through prepared statements (Drizzle generates these) and use the
 * indexed paths (`canonical.id`, `relationship.from_canonical_id`).
 */
export class EntityRepo {
  constructor(private readonly db: Db) {}

  async getCanonical(id: string): Promise<typeof entitySchema.canonical.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(entitySchema.canonical)
      .where(eq(entitySchema.canonical.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async getCanonicalMany(
    ids: readonly string[],
  ): Promise<readonly (typeof entitySchema.canonical.$inferSelect)[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(entitySchema.canonical)
      .where(inArray(entitySchema.canonical.id, ids as string[]));
  }

  /**
   * Postgres-side 1-hop neighbour lookup (fallback when Neo4j is degraded).
   * Returns relationship rows where the given canonical id is on either side.
   */
  async getRelationshipsForCanonical(
    canonicalId: string,
  ): Promise<readonly (typeof entitySchema.relationship.$inferSelect)[]> {
    return this.db
      .select()
      .from(entitySchema.relationship)
      .where(
        or(
          eq(entitySchema.relationship.from_canonical_id, canonicalId),
          eq(entitySchema.relationship.to_canonical_id, canonicalId),
        ),
      );
  }

  async getCanonicalByRccm(
    rccm: string,
  ): Promise<typeof entitySchema.canonical.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(entitySchema.canonical)
      .where(eq(entitySchema.canonical.rccm_number, rccm))
      .limit(1);
    return rows[0] ?? null;
  }

  async getCanonicalByNiu(niu: string): Promise<typeof entitySchema.canonical.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(entitySchema.canonical)
      .where(eq(entitySchema.canonical.niu, niu))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Atomic merge of `additions` into `entity.canonical.metadata` for a
   * single canonical id. Used by the graph-metric scheduler to write
   * communityId / pageRank / roundTripDetected / directorRingFlag /
   * roundTripHops back to Postgres after computation in Neo4j.
   *
   * Concurrency: jsonb concat (`metadata = metadata || $merge`) is atomic
   * in Postgres so two metric jobs writing different keys cannot lose
   * each other's writes. Last-writer-wins on the same key.
   */
  async mergeMetadata(
    id: string,
    additions: Record<string, unknown>,
  ): Promise<{ updated: boolean }> {
    const r = await this.db.execute(sql`
      UPDATE entity.canonical
      SET metadata = metadata || ${JSON.stringify(additions)}::jsonb
      WHERE id = ${id}
      RETURNING id
    `);
    return { updated: r.rows.length > 0 };
  }

  /**
   * Stream every canonical id (no payload). Used by graph-metric jobs
   * that need to walk the full entity table.
   */
  async listAllCanonicalIds(): Promise<readonly string[]> {
    const rows = await this.db
      .select({ id: entitySchema.canonical.id })
      .from(entitySchema.canonical);
    return rows.map((r) => r.id);
  }

  /** Bulk metadata merge — one round-trip per id. Sequenced to avoid
   *  flooding the connection pool. Caller passes (id, additions) tuples. */
  async bulkMergeMetadata(
    updates: ReadonlyArray<{ id: string; additions: Record<string, unknown> }>,
  ): Promise<{ updated: number }> {
    let updated = 0;
    for (const u of updates) {
      const { updated: ok } = await this.mergeMetadata(u.id, u.additions);
      if (ok) updated += 1;
    }
    return { updated };
  }
}
