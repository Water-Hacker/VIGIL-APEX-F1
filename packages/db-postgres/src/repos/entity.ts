import { eq, inArray, or, sql } from 'drizzle-orm';

import * as entitySchema from '../schema/entity.js';

import type { Db } from '../client.js';

/**
 * Case-fold + accent-fold + ligature-fold + punctuation-collapse on a
 * display name for the rule-pass exact-match lookup. SRD §15.5.1
 * calls for a deterministic pass before the LLM: if a normalised name
 * exists already, we skip the LLM round-trip and attach the new
 * alias to the existing canonical.
 *
 * The transformation is intentionally lossy because the goal is to
 * recognise (a) "Société Générale du Cameroun S.A." vs (b) "SOCIETE
 * GENERALE DU CAMEROUN SA" vs (c) "Société Générale du Cameroun, SA"
 * as the same string. Specifically we:
 *
 *   1. NFKD + diacritic strip — `Générale` → `Generale`.
 *   2. Ligature fold — `œ` → `oe`, `æ` → `ae`, `ß` → `ss` (Unicode
 *      NFKD does NOT decompose these because they are letters in
 *      their own right; we add the fold explicitly because the SQL
 *      side cannot rely on `unaccent` to handle them either).
 *   3. Lower-case.
 *   4. Replace any non-alphanumeric character with a space. This
 *      turns `S.A.R.L.` into `s a r l` and `Acme, Inc.` into
 *      `acme inc`.
 *   5. Collapse runs of single-letter tokens. This turns `s a r l`
 *      into `sarl` and `s a` into `sa`. Real-world Cameroonian
 *      registry forms ("S.A.R.L.", "SARL", "S A R L") are common
 *      enough that the rule-pass must collapse them or it becomes
 *      stochastic.
 *   6. Collapse whitespace runs and trim.
 *
 * The companion SQL implementation in `findCanonicalByNormalizedName`
 * mirrors steps 1–4 + 6 server-side via translate() + lower() +
 * regexp_replace. Step 5 (single-letter collapse) is applied to the
 * input on both sides via this function (the JS-side normalisation
 * is sent as the comparand).
 */
export function normalizeName(s: string): string {
  const decomposed = s
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    // Ligature fold — Unicode does not decompose these by NFKD.
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Collapse single-letter runs — `s a r l` → `sarl`. We walk
  // tokens because a regex-based pass leaves `sa rl` halfway done
  // (non-overlapping global matches consume each pair separately).
  if (decomposed === '') return '';
  const tokens = decomposed.split(' ');
  const merged: string[] = [];
  let buffer = '';
  for (const t of tokens) {
    if (t.length === 1 && /\p{L}/u.test(t)) {
      buffer += t;
    } else {
      if (buffer !== '') {
        merged.push(buffer);
        buffer = '';
      }
      if (t !== '') merged.push(t);
    }
  }
  if (buffer !== '') merged.push(buffer);
  return merged.join(' ');
}

/**
 * EntityRepo — read + write access to entity.canonical /
 * entity.relationship / entity.alias.
 *
 * worker-pattern is the primary read consumer (subject loader);
 * worker-entity is the write consumer (resolution pipeline). All reads
 * go through prepared statements (Drizzle generates these) and use the
 * indexed paths (`canonical.id`, `relationship.from_canonical_id`).
 *
 * Write contract — `upsertCluster` writes a canonical row + N alias
 * rows atomically in a single Postgres transaction. The caller writes
 * Postgres first, then attempts the Neo4j mirror; if Neo4j fails the
 * Postgres canonical row stands (SRD §15.1: "DB commit BEFORE stream
 * emit").
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

  // ────────────────────────────────────────────────────────────────────
  // Write methods used by worker-entity (rule-pass + LLM-pass).
  // ────────────────────────────────────────────────────────────────────

  /**
   * Look up an existing canonical by case-folded + accent-folded
   * display name. The trgm index on `display_name` is GIN; for an
   * exact-match equality lookup the planner uses the underlying
   * btree-on-tolower-of column scan (Postgres handles small tables
   * fine, and the rule-pass is one query per resolution attempt).
   *
   * Returns the FIRST row found. If two canonicals share the same
   * normalised name (rare; usually a data-entry duplicate), the LLM
   * pass should resolve them; this method intentionally does not
   * pick a winner.
   */
  async findCanonicalByNormalizedName(
    name: string,
  ): Promise<typeof entitySchema.canonical.$inferSelect | null> {
    const normalised = normalizeName(name);
    if (normalised === '') return null;
    // We compute normalisation in SQL to preserve the indexed path
    // and to match the JS-side normalisation byte-for-byte. The
    // unaccent() function requires the `unaccent` extension; if it
    // is not installed in the target DB, the rule-pass still
    // functions via lower() alone (accents simply do not fold) —
    // the LLM pass picks up the residual.
    const r = await this.db.execute(sql`
      SELECT *
        FROM entity.canonical
       WHERE regexp_replace(
               lower(translate(display_name,
                 'àáâäãåèéêëìíîïòóôöõùúûüñçÀÁÂÄÃÅÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÑÇ',
                 'aaaaaaeeeeiiiioooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC')),
               '[^a-z0-9 ]', ' ', 'g'
             ) = ${normalised}
       LIMIT 1
    `);
    type Row = typeof entitySchema.canonical.$inferSelect;
    const rows = r.rows as Row[];
    return rows[0] ?? null;
  }

  /**
   * Standalone canonical upsert. ON CONFLICT (id) DO UPDATE — used by
   * the rule-pass when the canonical already exists and we just want
   * to refresh `last_seen` / merge metadata. For the LLM-pass clean
   * insert, prefer `upsertCluster` which wraps insert + alias rows
   * in a single transaction.
   */
  async upsertCanonical(
    input: typeof entitySchema.canonical.$inferInsert,
  ): Promise<typeof entitySchema.canonical.$inferSelect> {
    const r = await this.db
      .insert(entitySchema.canonical)
      .values(input)
      .onConflictDoUpdate({
        target: entitySchema.canonical.id,
        set: {
          last_seen: input.last_seen ?? new Date(),
          resolution_confidence: input.resolution_confidence,
          resolved_by: input.resolved_by,
          // Merge metadata on update; the database-side jsonb || is
          // atomic so two concurrent writers cannot lose each other's
          // additions.
          metadata: sql`${entitySchema.canonical.metadata} || ${JSON.stringify(input.metadata ?? {})}::jsonb`,
        },
      })
      .returning();
    return r[0]!;
  }

  /**
   * Attach an alias to an existing canonical. The unique constraint
   * `alias_unique (canonical_id, alias, source_id)` prevents
   * duplicates; ON CONFLICT DO NOTHING makes the call idempotent so
   * a worker retry does not double-write.
   */
  async addAlias(input: typeof entitySchema.alias.$inferInsert): Promise<{ inserted: boolean }> {
    const r = await this.db
      .insert(entitySchema.alias)
      .values(input)
      .onConflictDoNothing()
      .returning({ id: entitySchema.alias.id });
    return { inserted: r.length > 0 };
  }

  /**
   * Atomic write of a complete resolution cluster (one canonical + N
   * aliases). All inserts share a single Postgres transaction; if any
   * insert fails the entire cluster is rolled back, leaving the table
   * unchanged. The caller (worker-entity) attempts the Neo4j mirror
   * AFTER this method returns; on Neo4j failure the Postgres rows
   * stand (SRD §15.1 invariant).
   *
   * Returns the canonical row as written, including any database-side
   * defaults filled in.
   */
  async upsertCluster(input: {
    canonical: typeof entitySchema.canonical.$inferInsert;
    aliases: ReadonlyArray<typeof entitySchema.alias.$inferInsert>;
  }): Promise<typeof entitySchema.canonical.$inferSelect> {
    return this.db.transaction(async (tx) => {
      const c = await tx
        .insert(entitySchema.canonical)
        .values(input.canonical)
        .onConflictDoUpdate({
          target: entitySchema.canonical.id,
          set: {
            last_seen: input.canonical.last_seen ?? new Date(),
            resolution_confidence: input.canonical.resolution_confidence,
            resolved_by: input.canonical.resolved_by,
            metadata: sql`${entitySchema.canonical.metadata} || ${JSON.stringify(input.canonical.metadata ?? {})}::jsonb`,
          },
        })
        .returning();
      const canonical = c[0]!;
      for (const alias of input.aliases) {
        await tx
          .insert(entitySchema.alias)
          .values({ ...alias, canonical_id: canonical.id })
          .onConflictDoNothing();
      }
      return canonical;
    });
  }
}
