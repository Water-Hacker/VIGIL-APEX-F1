import { desc, eq, sql } from 'drizzle-orm';

import { clampRepoLimit } from '../limit-cap.js';
import * as dossierSchema from '../schema/dossier.js';

import type { Db } from '../client.js';

/**
 * DossierOutcomeRepo — read/write for the FRONTIER-AUDIT Layer-7 outcome
 * feedback table. One row per (signal_id, dossier_id) high-confidence
 * match produced by worker-outcome-feedback.
 *
 * The `signal_id + dossier_id` unique constraint makes this idempotent
 * — re-delivery of the same signal does not create a duplicate row.
 */
export class DossierOutcomeRepo {
  constructor(private readonly db: Db) {}

  /**
   * Insert one outcome match. On unique conflict (signal + dossier
   * already recorded) this is a no-op; the caller can safely re-deliver
   * a signal envelope without producing duplicate audit chain entries.
   */
  async insertIfAbsent(
    row: typeof dossierSchema.dossierOutcome.$inferInsert,
  ): Promise<{ inserted: boolean }> {
    const result = await this.db
      .insert(dossierSchema.dossierOutcome)
      .values(row)
      .onConflictDoNothing({
        target: [dossierSchema.dossierOutcome.signal_id, dossierSchema.dossierOutcome.dossier_id],
      })
      .returning({ id: dossierSchema.dossierOutcome.id });
    return { inserted: result.length > 0 };
  }

  /**
   * List the most-recent outcomes for one dossier. Used by the dashboard
   * detail page to show "what happened after we delivered this."
   */
  async listForDossier(dossierId: string, limit = 20) {
    return this.db
      .select()
      .from(dossierSchema.dossierOutcome)
      .where(eq(dossierSchema.dossierOutcome.dossier_id, dossierId))
      .orderBy(desc(dossierSchema.dossierOutcome.matched_at))
      .limit(clampRepoLimit(limit));
  }

  /**
   * High-confidence outcomes in a time window, newest first. Used by
   * the calibration engine to refine pattern priors against observed
   * institutional action rates.
   */
  async listHighConfidenceSince(sinceIso: string, limit = 200) {
    return this.db
      .select()
      .from(dossierSchema.dossierOutcome)
      .where(
        sql`${dossierSchema.dossierOutcome.is_high_confidence} = true AND ${dossierSchema.dossierOutcome.matched_at} >= ${sinceIso}::timestamptz`,
      )
      .orderBy(desc(dossierSchema.dossierOutcome.matched_at))
      .limit(clampRepoLimit(limit));
  }
}

/**
 * Compact representation of a delivered dossier — exactly what
 * worker-outcome-feedback needs to run `matchSignalAgainstDossiers`.
 * The columns come from joining dossier × finding × canonical
 * (finding.subject_canonical_id → canonical.entity).
 *
 * This module ships the query helper so the worker doesn't need to
 * know the schema layout. The join is intentionally explicit — a
 * `SELECT *`-style hidden view would defeat audit-readability.
 */
export interface DeliveredDossierRow {
  readonly dossier_id: string;
  readonly dossier_ref: string;
  readonly recipient_body_name: string;
  readonly delivered_at: string;
  readonly finding_id: string;
  readonly primary_entity_id: string | null;
  readonly primary_entity_name: string | null;
  readonly primary_entity_aliases: ReadonlyArray<string>;
  readonly rccm: string | null;
  readonly niu: string | null;
  readonly pattern_categories: ReadonlyArray<string>;
  readonly ubo_names: ReadonlyArray<string>;
}

/**
 * List dossiers delivered in the past `windowDays` whose recipient body
 * is plausibly addressed by a signal of the given source. Joins
 * dossier × finding × canonical and gathers primary-entity identifiers.
 */
export async function listRecentDeliveredDossiersForMatching(
  db: Db,
  windowDays: number,
  limit = 500,
): Promise<ReadonlyArray<DeliveredDossierRow>> {
  // The query gathers dossier + finding + canonical fields and array-
  // aggregates UBO names. Pattern categories are derived from the
  // finding's signals which carry a pattern_id of shape P-X-NNN; we
  // extract the letter [A-P] for category alignment scoring.
  // The query joins dossier × finding × entity.canonical and gathers
  // primary-entity identifiers + per-finding pattern categories. UBO
  // names are sourced from entity.relationship rows of kind 'ubo'
  // pointing at the primary entity; we LEFT JOIN to tolerate findings
  // whose UBO chain hasn't been resolved yet.
  const result = await db.execute<{
    dossier_id: string;
    dossier_ref: string;
    recipient_body_name: string;
    delivered_at: Date;
    finding_id: string;
    primary_entity_id: string | null;
    primary_entity_name: string | null;
    primary_entity_aliases: string[] | null;
    rccm: string | null;
    niu: string | null;
    pattern_categories: string[] | null;
    ubo_names: string[] | null;
  }>(sql`
    SELECT
      d.id::text                                         AS dossier_id,
      d.ref                                              AS dossier_ref,
      d.recipient_body_name                              AS recipient_body_name,
      d.delivered_at                                     AS delivered_at,
      d.finding_id::text                                 AS finding_id,
      c.id::text                                         AS primary_entity_id,
      c.display_name                                     AS primary_entity_name,
      COALESCE(
        ARRAY(
          SELECT DISTINCT a.alias
          FROM entity.alias a
          WHERE a.canonical_id = c.id
          LIMIT 20
        ),
        ARRAY[]::text[]
      )                                                  AS primary_entity_aliases,
      c.rccm_number                                      AS rccm,
      c.niu                                              AS niu,
      COALESCE(
        ARRAY(
          SELECT DISTINCT substring(s.pattern_id FROM 'P-([A-P])-')
          FROM finding.signal s
          WHERE s.finding_id = d.finding_id
            AND s.pattern_id IS NOT NULL
            AND substring(s.pattern_id FROM 'P-([A-P])-') IS NOT NULL
        ),
        ARRAY[]::text[]
      )                                                  AS pattern_categories,
      COALESCE(
        ARRAY(
          SELECT DISTINCT uboe.display_name
          FROM entity.relationship r
          JOIN entity.canonical uboe ON uboe.id = r.from_canonical_id
          WHERE r.to_canonical_id = c.id
            AND r.kind = 'ubo'
          LIMIT 20
        ),
        ARRAY[]::text[]
      )                                                  AS ubo_names
    FROM dossier.dossier d
    JOIN finding.finding f ON f.id = d.finding_id
    LEFT JOIN entity.canonical c ON c.id = f.primary_entity_id
    WHERE d.delivered_at IS NOT NULL
      AND d.delivered_at >= now() - (${windowDays}::int * INTERVAL '1 day')
      AND d.language = 'fr'
    ORDER BY d.delivered_at DESC
    LIMIT ${limit};
  `);

  return result.rows.map((r) => ({
    dossier_id: r.dossier_id,
    dossier_ref: r.dossier_ref,
    recipient_body_name: r.recipient_body_name,
    delivered_at: r.delivered_at.toISOString(),
    finding_id: r.finding_id,
    primary_entity_id: r.primary_entity_id,
    primary_entity_name: r.primary_entity_name,
    primary_entity_aliases: r.primary_entity_aliases ?? [],
    rccm: r.rccm,
    niu: r.niu,
    pattern_categories: r.pattern_categories ?? [],
    ubo_names: r.ubo_names ?? [],
  }));
}
