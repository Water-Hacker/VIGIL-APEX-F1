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

  async getCanonicalByNiu(
    niu: string,
  ): Promise<typeof entitySchema.canonical.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(entitySchema.canonical)
      .where(eq(entitySchema.canonical.niu, niu))
      .limit(1);
    return rows[0] ?? null;
  }
}
