import { and, desc, eq, sql } from 'drizzle-orm';

import * as al from '../schema/audit-log.js';

import type { Db } from '../client.js';

/**
 * DECISION-012 — TAL-PA repos.
 *
 * `UserActionEventRepo` is the persistence side of the
 * `@vigil/audit-log` SDK. It also owns the per-actor chain tracker
 * (`userActionChain`) so the SDK can read+update the actor's latest
 * event id atomically.
 *
 * `PublicAnchorRepo` records high-sig event → Polygon tx mappings.
 * `AnomalyAlertRepo` is written by `worker-audit-watch`.
 * `RedactionRepo` records every public-view-field redaction.
 * `PublicExportRepo` records quarterly CSV publications.
 * `SessionRepo` stores authenticated session metadata.
 */

export type UserActionEventRow = typeof al.userActionEvent.$inferSelect;
export type UserActionEventInsert = typeof al.userActionEvent.$inferInsert;

export class UserActionEventRepo {
  constructor(private readonly db: Db) {}

  /**
   * Fetch the latest event-id + hash for an actor in a single round trip,
   * used by `@vigil/audit-log/emit()` to compute prior_event_id without
   * scanning the entire chain.
   */
  async latestForActor(
    actorId: string,
  ): Promise<{ eventId: string; eventHash: string } | null> {
    const rows = await this.db
      .select()
      .from(al.userActionChain)
      .where(eq(al.userActionChain.actor_id, actorId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { eventId: row.latest_event_id, eventHash: row.latest_event_hash };
  }

  /**
   * Insert one TAL-PA event AND atomically update the per-actor chain
   * row. Caller passes the freshly computed prior_event_id and
   * record_hash; the repo refuses to write if the prior_event_id does
   * not match the current actor-chain head (CAS).
   */
  async insertAndAdvanceChain(row: UserActionEventInsert): Promise<void> {
    await this.db.transaction(async (tx) => {
      // CAS — verify the head matches what the caller computed against.
      const currentRows = await tx
        .select()
        .from(al.userActionChain)
        .where(eq(al.userActionChain.actor_id, row.actor_id))
        .for('update');
      const current = currentRows[0];
      if (current) {
        if (row.prior_event_id !== current.latest_event_id) {
          throw new Error(
            `audit-log CAS failure for actor=${row.actor_id}: ` +
              `expected prior=${current.latest_event_id}, got ${row.prior_event_id}`,
          );
        }
      } else {
        if (row.prior_event_id !== null && row.prior_event_id !== undefined) {
          throw new Error(
            `audit-log CAS failure for actor=${row.actor_id}: chain empty but prior_event_id=${row.prior_event_id}`,
          );
        }
      }
      await tx.insert(al.userActionEvent).values(row);
      await tx
        .insert(al.userActionChain)
        .values({
          actor_id: row.actor_id,
          latest_event_id: row.event_id,
          latest_event_hash: row.record_hash,
          latest_at: new Date(
            row.timestamp_utc instanceof Date
              ? row.timestamp_utc.getTime()
              : new Date(row.timestamp_utc as string).getTime(),
          ),
          event_count: 1,
        })
        .onConflictDoUpdate({
          target: al.userActionChain.actor_id,
          set: {
            latest_event_id: row.event_id,
            latest_event_hash: row.record_hash,
            latest_at: sql`now()`,
            event_count: sql`${al.userActionChain.event_count} + 1`,
          },
        });
    });
  }

  async listByActor(
    actorId: string,
    limit = 100,
  ): Promise<readonly UserActionEventRow[]> {
    return this.db
      .select()
      .from(al.userActionEvent)
      .where(eq(al.userActionEvent.actor_id, actorId))
      .orderBy(desc(al.userActionEvent.timestamp_utc))
      .limit(limit);
  }

  async listByCategory(
    category: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K',
    limit = 100,
  ): Promise<readonly UserActionEventRow[]> {
    return this.db
      .select()
      .from(al.userActionEvent)
      .where(eq(al.userActionEvent.category, category))
      .orderBy(desc(al.userActionEvent.timestamp_utc))
      .limit(limit);
  }

  /** Page through events for the public API. The PII-redaction step is the
   *  caller's responsibility (see `Schemas.zPublicAuditView`). */
  async listPublic(opts: {
    sinceIso?: string;
    untilIso?: string;
    category?: string;
    limit?: number;
    offset?: number;
  }): Promise<readonly UserActionEventRow[]> {
    const conds = [] as Array<ReturnType<typeof eq>>;
    if (opts.sinceIso) conds.push(sql`timestamp_utc >= ${opts.sinceIso}::timestamptz` as never);
    if (opts.untilIso) conds.push(sql`timestamp_utc < ${opts.untilIso}::timestamptz` as never);
    if (opts.category) conds.push(eq(al.userActionEvent.category, opts.category));
    return this.db
      .select()
      .from(al.userActionEvent)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(al.userActionEvent.timestamp_utc))
      .limit(Math.min(opts.limit ?? 100, 500))
      .offset(opts.offset ?? 0);
  }

  /** High-sig events without a Polygon anchor yet — drained by worker-anchor. */
  async listPendingHighSig(limit = 50): Promise<readonly UserActionEventRow[]> {
    return this.db
      .select()
      .from(al.userActionEvent)
      .where(
        and(
          eq(al.userActionEvent.high_significance, true),
          sql`${al.userActionEvent.chain_anchor_tx} IS NULL`,
        ),
      )
      .orderBy(al.userActionEvent.timestamp_utc)
      .limit(limit);
  }

  async setAnchorTx(eventId: string, polygonTxHash: string): Promise<void> {
    await this.db
      .update(al.userActionEvent)
      .set({ chain_anchor_tx: polygonTxHash })
      .where(eq(al.userActionEvent.event_id, eventId));
  }

  /**
   * Aggregate counts for a public dashboard tile — events per role per
   * category in a window. Cheap covering-index query.
   */
  async aggregateCounts(opts: {
    sinceIso: string;
    untilIso: string;
  }): Promise<ReadonlyArray<{ role: string; category: string; total: number }>> {
    const r = await this.db.execute(sql`
      SELECT actor_role AS role, category, COUNT(*)::bigint AS total
        FROM audit.user_action_event
       WHERE timestamp_utc >= ${opts.sinceIso}::timestamptz
         AND timestamp_utc <  ${opts.untilIso}::timestamptz
       GROUP BY actor_role, category
       ORDER BY total DESC
    `);
    return (r.rows as Array<{ role: string; category: string; total: number | string }>).map(
      (row) => ({ role: row.role, category: row.category, total: Number(row.total) }),
    );
  }
}

export class SessionRepo {
  constructor(private readonly db: Db) {}

  async create(row: typeof al.auditSession.$inferInsert): Promise<void> {
    await this.db.insert(al.auditSession).values(row).onConflictDoNothing();
  }

  async terminate(sessionId: string): Promise<void> {
    await this.db
      .update(al.auditSession)
      .set({ terminated_at: new Date() })
      .where(eq(al.auditSession.id, sessionId));
  }

  async getActive(sessionId: string): Promise<typeof al.auditSession.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(al.auditSession)
      .where(eq(al.auditSession.id, sessionId))
      .limit(1);
    return rows[0] ?? null;
  }
}

export class PublicAnchorRepo {
  constructor(private readonly db: Db) {}

  async record(row: typeof al.publicAnchor.$inferInsert): Promise<void> {
    await this.db.insert(al.publicAnchor).values(row);
  }
}

export class AnomalyAlertRepo {
  constructor(private readonly db: Db) {}

  async create(row: typeof al.anomalyAlert.$inferInsert): Promise<void> {
    await this.db.insert(al.anomalyAlert).values(row);
  }

  async listOpen(limit = 100): Promise<readonly (typeof al.anomalyAlert.$inferSelect)[]> {
    return this.db
      .select()
      .from(al.anomalyAlert)
      .where(eq(al.anomalyAlert.state, 'open'))
      .orderBy(desc(al.anomalyAlert.detected_at))
      .limit(limit);
  }

  async setState(
    id: string,
    state: 'open' | 'acknowledged' | 'dismissed' | 'promoted_to_finding',
  ): Promise<void> {
    await this.db.update(al.anomalyAlert).set({ state }).where(eq(al.anomalyAlert.id, id));
  }
}

export class RedactionRepo {
  constructor(private readonly db: Db) {}

  async record(row: typeof al.auditRedaction.$inferInsert): Promise<void> {
    await this.db.insert(al.auditRedaction).values(row);
  }

  async listForEvent(
    eventId: string,
  ): Promise<readonly (typeof al.auditRedaction.$inferSelect)[]> {
    return this.db
      .select()
      .from(al.auditRedaction)
      .where(eq(al.auditRedaction.event_id, eventId))
      .orderBy(desc(al.auditRedaction.redacted_at));
  }
}

export class PublicExportRepo {
  constructor(private readonly db: Db) {}

  async record(row: typeof al.publicExport.$inferInsert): Promise<void> {
    await this.db.insert(al.publicExport).values(row).onConflictDoNothing();
  }

  async list(limit = 24): Promise<readonly (typeof al.publicExport.$inferSelect)[]> {
    return this.db
      .select()
      .from(al.publicExport)
      .orderBy(desc(al.publicExport.exported_at))
      .limit(limit);
  }
}
