import { createHash, randomUUID } from 'node:crypto';

import { desc, eq, sql } from 'drizzle-orm';

import { clampRepoLimit } from '../limit-cap.js';
import * as tipSchema from '../schema/tip.js';

import type { Db } from '../client.js';

/**
 * TipRepo — tamper-evident citizen-tip storage (DECISION-016).
 *
 * Contract:
 *   - Insert: append-only at the database layer (DB trigger blocks
 *     DELETE; see migration 0011_tip_no_delete.sql).
 *   - Disposition change: routed through `recordDispositionChange()`
 *     which updates the row AND appends to `tip.tip_disposition_history`
 *     in a single transaction. The history table is itself trigger-
 *     protected against UPDATE / DELETE.
 *   - Redaction: `redact()` blanks the body ciphertext but preserves
 *     the row + history. Citizens verifying their reference still
 *     receive "your tip is in the system" — the receipt's
 *     `body_intact: false` flag makes the redaction transparent.
 *   - Citizen receipt: `buildReceipt()` returns the SHA-256 of the
 *     stored body ciphertext + the audit-event-id of the most recent
 *     disposition change. The citizen re-derives the SHA-256 from
 *     their own copy of the ciphertext (their browser kept it) and
 *     confirms the system has not modified it.
 *
 * The repo intentionally exposes NO direct delete method. The DB
 * trigger is the second line of defence.
 */
export class TipRepo {
  constructor(private readonly db: Db) {}

  async insert(row: typeof tipSchema.tip.$inferInsert): Promise<void> {
    await this.db.insert(tipSchema.tip).values(row);
  }

  async getByRef(ref: string) {
    const rows = await this.db
      .select()
      .from(tipSchema.tip)
      .where(eq(tipSchema.tip.ref, ref))
      .limit(1);
    return rows[0] ?? null;
  }

  async getById(id: string) {
    const rows = await this.db
      .select()
      .from(tipSchema.tip)
      .where(eq(tipSchema.tip.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listForTriage(limit = 50) {
    return this.db
      .select()
      .from(tipSchema.tip)
      .where(sql`disposition IN ('NEW','IN_TRIAGE')`)
      .orderBy(desc(tipSchema.tip.received_at))
      .limit(clampRepoLimit(limit));
  }

  /**
   * @deprecated Use {@link recordDispositionChange} instead. Direct
   * disposition writes bypass the audit trail required by DECISION-016.
   * Retained on the surface during the worker-tip-triage migration; it
   * still updates triaged_at/triaged_by fields, but does NOT append a
   * history row — callers MUST migrate to recordDispositionChange.
   */
  async setDisposition(id: string, disposition: string, by: string) {
    await this.db
      .update(tipSchema.tip)
      .set({ disposition, triaged_at: new Date(), triaged_by: by })
      .where(eq(tipSchema.tip.id, id));
  }

  /**
   * Mandatory path for any disposition transition. Atomic:
   *   (1) updates `tip.disposition` + triaged_{at,by},
   *   (2) appends a row to `tip.tip_disposition_history` capturing the
   *       prior + new disposition, the actor, the optional notes, and
   *       the audit_event_id of the TAL-PA emit (caller-supplied).
   *
   * Throws if the transition is not in the closed graph
   * {@link ALLOWED_TRANSITIONS}. Returns the prior disposition for
   * caller-side logging.
   */
  async recordDispositionChange(input: {
    readonly id: string;
    readonly newDisposition: string;
    readonly actor: string;
    readonly auditEventId: string | null;
    readonly notes?: string | null;
    readonly redactBody?: boolean;
  }): Promise<{ priorDisposition: string }> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ disposition: tipSchema.tip.disposition })
        .from(tipSchema.tip)
        .where(eq(tipSchema.tip.id, input.id))
        .limit(1);
      const current = rows[0];
      if (!current) throw new Error(`tip not found: ${input.id}`);
      const prior = current.disposition;
      if (!isAllowedTransition(prior, input.newDisposition)) {
        throw new Error(
          `tip.disposition transition not allowed: ${prior} → ${input.newDisposition}`,
        );
      }

      const updates: Partial<typeof tipSchema.tip.$inferInsert> = {
        disposition: input.newDisposition,
        triaged_at: new Date(),
        triaged_by: input.actor,
      };
      if (input.redactBody === true && input.newDisposition === 'REDACTED_BY_COURT_ORDER') {
        updates.body_ciphertext = Buffer.alloc(0);
        updates.contact_ciphertext = null;
        updates.triage_notes_ciphertext = null;
      } else if (input.redactBody === true) {
        throw new Error(
          'redactBody=true is only valid when transitioning to REDACTED_BY_COURT_ORDER',
        );
      }

      await tx.update(tipSchema.tip).set(updates).where(eq(tipSchema.tip.id, input.id));

      await tx.insert(tipSchema.tipDispositionHistory).values({
        id: randomUUID(),
        tip_id: input.id,
        prior_disposition: prior,
        new_disposition: input.newDisposition,
        actor: input.actor,
        notes: input.notes ?? null,
        audit_event_id: input.auditEventId,
      });

      return { priorDisposition: prior };
    });
  }

  /**
   * Court-ordered redaction. Blanks the body ciphertext, preserves
   * the row + the history trail. The audit_event_id MUST be supplied —
   * a redaction without an audit anchor is rejected.
   */
  async redact(input: {
    readonly id: string;
    readonly actor: string;
    readonly auditEventId: string;
    readonly courtOrderRef: string;
  }): Promise<{ priorDisposition: string }> {
    if (!input.auditEventId) {
      throw new Error('redact() requires an audit_event_id; refusing to proceed without trail');
    }
    return this.recordDispositionChange({
      id: input.id,
      newDisposition: 'REDACTED_BY_COURT_ORDER',
      actor: input.actor,
      auditEventId: input.auditEventId,
      notes: `court order: ${input.courtOrderRef}`,
      redactBody: true,
    });
  }

  /**
   * Read the disposition trail for a tip, newest first. Used by the
   * triage UI's "history" pane and the citizen-receipt builder.
   */
  async listDispositionHistory(tipId: string) {
    return this.db
      .select()
      .from(tipSchema.tipDispositionHistory)
      .where(eq(tipSchema.tipDispositionHistory.tip_id, tipId))
      .orderBy(desc(tipSchema.tipDispositionHistory.recorded_at));
  }

  /**
   * Build the citizen-verifiable receipt for a TIP-YYYY-NNNN ref.
   * Returns null if the ref is unknown — callers handle confidentiality
   * (no timing-side-channel disclosure).
   */
  async buildReceipt(ref: string): Promise<{
    ref: string;
    received_at: string;
    disposition: string;
    body_ciphertext_sha256: string;
    last_disposition_audit_event_id: string | null;
    body_intact: boolean;
  } | null> {
    const tip = await this.getByRef(ref);
    if (!tip) return null;
    const history = await this.listDispositionHistory(tip.id);
    const last = history[0];
    const body = tip.body_ciphertext as Buffer | null;
    const sha =
      body && body.length > 0 ? createHash('sha256').update(body).digest('hex') : '0'.repeat(64);
    return {
      ref: tip.ref,
      received_at: tip.received_at.toISOString(),
      disposition: tip.disposition,
      body_ciphertext_sha256: sha,
      last_disposition_audit_event_id: last?.audit_event_id ?? null,
      body_intact: tip.disposition !== 'REDACTED_BY_COURT_ORDER',
    };
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

/**
 * Closed transition graph. Every other transition throws.
 * REDACTED_BY_COURT_ORDER is terminal — no path leaves it.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  NEW: new Set(['IN_TRIAGE', 'DISMISSED', 'ARCHIVED', 'PROMOTED', 'REDACTED_BY_COURT_ORDER']),
  IN_TRIAGE: new Set(['DISMISSED', 'ARCHIVED', 'PROMOTED', 'REDACTED_BY_COURT_ORDER']),
  DISMISSED: new Set(['ARCHIVED', 'REDACTED_BY_COURT_ORDER']),
  ARCHIVED: new Set(['REDACTED_BY_COURT_ORDER']),
  PROMOTED: new Set(['ARCHIVED', 'REDACTED_BY_COURT_ORDER']),
  REDACTED_BY_COURT_ORDER: new Set(), // terminal
};

export function isAllowedTransition(from: string, to: string): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from]?.has(to) ?? false;
}

export const TIP_DISPOSITION_TRANSITIONS = ALLOWED_TRANSITIONS;
