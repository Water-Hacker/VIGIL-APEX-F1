import { and, eq, sql } from 'drizzle-orm';

import * as dossierSchema from '../schema/dossier.js';
import type { Db } from '../client.js';

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
      .where(
        and(
          eq(dossierSchema.dossier.ref, ref),
          eq(dossierSchema.dossier.language, language),
        ),
      )
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

  async markAcknowledged(
    id: string,
    recipient_case_reference: string,
  ): Promise<void> {
    await this.db
      .update(dossierSchema.dossier)
      .set({
        acknowledged_at: new Date(),
        recipient_case_reference,
        status: 'acknowledged',
      })
      .where(eq(dossierSchema.dossier.id, id));
  }
}
