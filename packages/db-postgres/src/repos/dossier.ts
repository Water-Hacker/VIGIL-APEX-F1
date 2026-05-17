import { randomUUID } from 'node:crypto';

import { and, desc, eq, sql } from 'drizzle-orm';

import { clampRepoLimit } from '../limit-cap.js';
import * as dossierSchema from '../schema/dossier.js';

import type { Db } from '../client.js';

export type RecipientBodyName = 'CONAC' | 'COUR_DES_COMPTES' | 'MINFI' | 'ANIF' | 'CDC' | 'OTHER';

export type RoutingDecisionSource = 'auto' | 'operator' | 'council';

/**
 * DossierRepo — read/write access to dossier.{dossier,referral,dossier_sequence}.
 *
 * Used by:
 *   - worker-dossier (A5): allocate seq via dossier_sequence; insert dossier rows
 *   - worker-conac-sftp (A4): list all language variants for a finding; record
 *     delivery / ACK timestamps
 *   - dashboard / API: surface dossier history per finding
 */
export class DossierRepo {
  constructor(private readonly db: Db) {}

  /**
   * Allocate the next dossier sequence number for a year. UPSERT-INCR pattern
   * matches the SQL helper `dossier.next_seq(yr)` shipped with migration 0001.
   */
  async nextSeq(year: number): Promise<number> {
    const r = await this.db.execute<{ next_seq: number }>(sql`
      INSERT INTO dossier.dossier_sequence (year, next_seq)
      VALUES (${year}, 2)
      ON CONFLICT (year) DO UPDATE
        SET next_seq = dossier.dossier_sequence.next_seq + 1
      RETURNING next_seq - 1 AS next_seq
    `);
    const row = r.rows[0];
    if (!row) throw new Error(`dossier.next_seq returned no row for year=${year}`);
    return Number(row.next_seq);
  }

  async insert(row: typeof dossierSchema.dossier.$inferInsert): Promise<void> {
    await this.db.insert(dossierSchema.dossier).values(row).onConflictDoNothing();
  }

  async getByRef(
    ref: string,
    language: 'fr' | 'en',
  ): Promise<typeof dossierSchema.dossier.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(dossierSchema.dossier)
      .where(and(eq(dossierSchema.dossier.ref, ref), eq(dossierSchema.dossier.language, language)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByFinding(
    findingId: string,
  ): Promise<readonly (typeof dossierSchema.dossier.$inferSelect)[]> {
    return this.db
      .select()
      .from(dossierSchema.dossier)
      .where(eq(dossierSchema.dossier.finding_id, findingId));
  }

  async markDelivered(id: string, manifest_hash: string): Promise<void> {
    await this.db
      .update(dossierSchema.dossier)
      .set({ delivered_at: new Date(), manifest_hash, status: 'delivered' })
      .where(eq(dossierSchema.dossier.id, id));
  }

  async markAcknowledged(id: string, recipient_case_reference: string): Promise<void> {
    await this.db
      .update(dossierSchema.dossier)
      .set({
        acknowledged_at: new Date(),
        recipient_case_reference,
        status: 'acknowledged',
      })
      .where(eq(dossierSchema.dossier.id, id));
  }

  /** DECISION-010 — set or change the recipient body for a finding. */
  async setRecipientBody(
    findingId: string,
    body: RecipientBodyName,
    source: RoutingDecisionSource,
    decidedBy: string,
    rationale: string,
  ): Promise<typeof dossierSchema.routingDecision.$inferSelect> {
    const decidedAt = new Date();
    const row: typeof dossierSchema.routingDecision.$inferInsert = {
      id: randomUUID(),
      finding_id: findingId,
      recipient_body_name: body,
      source,
      decided_by: decidedBy,
      decided_at: decidedAt,
      rationale,
    };
    const [persisted] = await this.db.insert(dossierSchema.routingDecision).values(row).returning();
    if (!persisted) {
      throw new Error('routing_decision: insert returned no row');
    }
    // Propagate to existing un-delivered dossier rows for this finding.
    await this.db
      .update(dossierSchema.dossier)
      .set({ recipient_body_name: body })
      .where(
        and(
          eq(dossierSchema.dossier.finding_id, findingId),
          // Only re-route while the dossier has not yet been delivered;
          // delivered/acknowledged dossiers are immutable per audit policy.
          sql`${dossierSchema.dossier.status} IN ('rendered','signed','pinned','failed')`,
        ),
      );
    return persisted;
  }

  /** Returns the latest routing decision for a finding, or null. */
  async latestRoutingDecision(
    findingId: string,
  ): Promise<typeof dossierSchema.routingDecision.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(dossierSchema.routingDecision)
      .where(eq(dossierSchema.routingDecision.finding_id, findingId))
      .orderBy(desc(dossierSchema.routingDecision.decided_at))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Full audit trail of routing decisions for a finding (newest first). */
  async listRoutingDecisions(
    findingId: string,
  ): Promise<readonly (typeof dossierSchema.routingDecision.$inferSelect)[]> {
    return this.db
      .select()
      .from(dossierSchema.routingDecision)
      .where(eq(dossierSchema.routingDecision.finding_id, findingId))
      .orderBy(desc(dossierSchema.routingDecision.decided_at));
  }
}

/**
 * SatelliteRequestRepo — DECISION-010 tracker for satellite-verification jobs.
 * Used by:
 *   - apps/adapter-runner satellite-trigger (idempotent insert)
 *   - dashboard satellite-recheck endpoint (manual queue)
 *   - apps/worker-satellite (Python; updates status/result)
 */
export class SatelliteRequestRepo {
  constructor(private readonly db: Db) {}

  async findByProjectWindow(
    projectId: string,
    contractStart: Date,
    contractEnd: Date,
  ): Promise<typeof dossierSchema.satelliteRequest.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(dossierSchema.satelliteRequest)
      .where(
        and(
          eq(dossierSchema.satelliteRequest.project_id, projectId),
          eq(
            dossierSchema.satelliteRequest.contract_start,
            contractStart.toISOString().slice(0, 10),
          ),
          eq(dossierSchema.satelliteRequest.contract_end, contractEnd.toISOString().slice(0, 10)),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async create(
    row: typeof dossierSchema.satelliteRequest.$inferInsert,
  ): Promise<typeof dossierSchema.satelliteRequest.$inferSelect> {
    const [r] = await this.db
      .insert(dossierSchema.satelliteRequest)
      .values(row)
      .onConflictDoNothing()
      .returning();
    if (r) return r;
    // Conflict — return the existing row.
    const existing = await this.findByProjectWindow(
      row.project_id,
      typeof row.contract_start === 'string' ? new Date(row.contract_start) : row.contract_start,
      typeof row.contract_end === 'string' ? new Date(row.contract_end) : row.contract_end,
    );
    if (!existing)
      throw new Error('satellite_request: insert returned no row and conflict lookup failed');
    return existing;
  }

  async listPending(
    limit = 100,
  ): Promise<readonly (typeof dossierSchema.satelliteRequest.$inferSelect)[]> {
    return this.db
      .select()
      .from(dossierSchema.satelliteRequest)
      .where(eq(dossierSchema.satelliteRequest.status, 'queued'))
      .limit(clampRepoLimit(limit));
  }
}
