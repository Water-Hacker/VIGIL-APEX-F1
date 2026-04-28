import { auditChainSeq, createLogger, type Logger } from '@vigil/observability';
import { Errors, Schemas, Ids } from '@vigil/shared';
import type { Pool } from 'pg';

import { bodyHash, rowHash } from './canonical.js';

/**
 * HashChain — append-only, hash-linked audit log in Postgres.
 *
 * Schema (DDL emitted by @vigil/db-postgres):
 *
 *   CREATE TABLE audit.actions (
 *     id           UUID PRIMARY KEY,
 *     seq          BIGINT NOT NULL UNIQUE,
 *     action       TEXT NOT NULL,
 *     actor        TEXT NOT NULL,
 *     subject_kind TEXT NOT NULL,
 *     subject_id   TEXT NOT NULL,
 *     occurred_at  TIMESTAMPTZ NOT NULL,
 *     payload      JSONB NOT NULL,
 *     prev_hash    BYTEA,
 *     body_hash    BYTEA NOT NULL,
 *     PRIMARY KEY (id),
 *     UNIQUE (seq)
 *   );
 *
 * The append path is wrapped in a SERIALIZABLE transaction that reads the
 * current `MAX(seq)` and writes `seq+1` with the prev_hash bound to that
 * row's hash. Conflicts retry up to 3 times.
 */

export class HashChain {
  private readonly logger: Logger;

  constructor(
    private readonly pool: Pool,
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger({ service: 'audit-chain' });
  }

  /**
   * Append one event to the chain. Returns the inserted event including
   * computed `seq`, `prev_hash`, and `body_hash`.
   */
  async append(input: {
    action: Schemas.AuditAction;
    actor: string;
    subject_kind: Schemas.AuditEvent['subject_kind'];
    subject_id: string;
    occurred_at?: string;
    payload?: Record<string, unknown>;
  }): Promise<Schemas.AuditEvent> {
    const occurred_at = input.occurred_at ?? new Date().toISOString();
    const payload = input.payload ?? {};

    let lastErr: unknown;
    let id = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      // Fresh UUID per attempt — a serialization rollback might or might not
      // have actually inserted the row (rare but possible under nested
      // failures), and reusing the same UUID would deadlock the retry on a
      // PK conflict instead of advancing. seq is still allocated atomically
      // inside the SERIALIZABLE transaction.
      id = Ids.newAuditEventId() as string;
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

        const tail = await client.query<{ seq: string; body_hash: Buffer }>(
          'SELECT seq, body_hash FROM audit.actions ORDER BY seq DESC LIMIT 1',
        );
        const lastSeq = tail.rows[0] ? BigInt(tail.rows[0].seq) : 0n;
        const seq = lastSeq + 1n;
        const prevHash = tail.rows[0]?.body_hash.toString('hex') ?? null;

        const event = {
          seq: Number(seq),
          action: input.action,
          actor: input.actor,
          subject_kind: input.subject_kind,
          subject_id: input.subject_id,
          occurred_at,
          payload,
        };
        const bh = bodyHash(event);
        const rh = rowHash(prevHash, bh);

        await client.query(
          `INSERT INTO audit.actions
             (id, seq, action, actor, subject_kind, subject_id, occurred_at, payload, prev_hash, body_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
          [
            id,
            String(seq),
            event.action,
            event.actor,
            event.subject_kind,
            event.subject_id,
            event.occurred_at,
            JSON.stringify(event.payload),
            prevHash !== null ? Buffer.from(prevHash, 'hex') : null,
            Buffer.from(rh, 'hex'),
          ],
        );

        await client.query('COMMIT');
        auditChainSeq.set(Number(seq));

        return {
          id,
          seq: Number(seq),
          action: event.action,
          actor: event.actor,
          subject_kind: event.subject_kind,
          subject_id: event.subject_id,
          occurred_at,
          payload,
          prev_hash: (prevHash as Schemas.AuditEvent['prev_hash']) ?? null,
          body_hash: rh as Schemas.AuditEvent['body_hash'],
        };
      } catch (e) {
        lastErr = e;
        await client.query('ROLLBACK').catch(() => {});
        // Serialization failure ⇒ retry
      } finally {
        client.release();
      }
    }
    throw new Errors.AuditChainError({
      code: 'AUDIT_APPEND_FAILED',
      message: 'Hash chain append failed after retries',
      severity: 'fatal',
      cause: lastErr,
    });
  }

  /** Sweep [from..to]; throw on first break. Returns count verified. */
  async verify(from = 1, to?: number): Promise<number> {
    const client = await this.pool.connect();
    try {
      const upper = to ?? Number.MAX_SAFE_INTEGER;
      let prev: string | null = null;
      let seqExpected = from;
      const cursor = await client.query<{
        id: string;
        seq: string;
        action: string;
        actor: string;
        subject_kind: string;
        subject_id: string;
        occurred_at: Date;
        payload: Record<string, unknown>;
        prev_hash: Buffer | null;
        body_hash: Buffer;
      }>(
        `SELECT id, seq, action, actor, subject_kind, subject_id, occurred_at, payload, prev_hash, body_hash
           FROM audit.actions
          WHERE seq BETWEEN $1 AND $2
       ORDER BY seq ASC`,
        [from, upper],
      );
      let verified = 0;
      for (const row of cursor.rows) {
        const seq = Number(row.seq);
        if (seq !== seqExpected) {
          throw new Errors.HashChainBrokenError(row.id, String(seqExpected), String(seq));
        }
        const recomputedBody = bodyHash({
          seq,
          action: row.action as Schemas.AuditAction,
          actor: row.actor,
          subject_kind: row.subject_kind as Schemas.AuditEvent['subject_kind'],
          subject_id: row.subject_id,
          occurred_at: row.occurred_at.toISOString(),
          payload: row.payload,
        });
        const recomputedRow = rowHash(prev, recomputedBody);
        const stored = row.body_hash.toString('hex');
        if (recomputedRow !== stored) {
          throw new Errors.HashChainBrokenError(row.id, recomputedRow, stored);
        }
        const storedPrev = row.prev_hash ? row.prev_hash.toString('hex') : null;
        if (storedPrev !== prev) {
          throw new Errors.HashChainBrokenError(row.id, prev ?? '<null>', storedPrev ?? '<null>');
        }
        prev = stored;
        seqExpected = seq + 1;
        verified++;
      }
      return verified;
    } finally {
      client.release();
    }
  }

  /** Latest seq + body hash — used to commit the next anchor. */
  async tail(): Promise<{ seq: number; bodyHash: string } | null> {
    const r = await this.pool.query<{ seq: string; body_hash: Buffer }>(
      'SELECT seq, body_hash FROM audit.actions ORDER BY seq DESC LIMIT 1',
    );
    if (r.rows.length === 0) return null;
    return { seq: Number(r.rows[0]!.seq), bodyHash: r.rows[0]!.body_hash.toString('hex') };
  }
}
