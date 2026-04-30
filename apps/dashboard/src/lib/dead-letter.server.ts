import 'server-only';

import { getDb } from '@vigil/db-postgres';
import { sql } from 'drizzle-orm';

export interface DeadLetterRow {
  readonly id: string;
  readonly source_id: string | null;
  readonly worker: string;
  readonly error_class: string;
  readonly reason: string;
  readonly retry_count: number;
  readonly first_seen: string;
  readonly last_attempt: string;
  readonly resolved_at: string | null;
}

export async function listDeadLetter(opts: {
  resolved?: boolean;
  limit?: number;
}): Promise<DeadLetterRow[]> {
  const db = await getDb();
  const r = await db.execute(sql`
    SELECT id::text, source_id, worker, error_class, reason,
           retry_count, first_seen::text, last_attempt::text, resolved_at::text
      FROM source.dead_letter
     ${opts.resolved === false ? sql`WHERE resolved_at IS NULL` : sql``}
     ORDER BY last_attempt DESC
     LIMIT ${opts.limit ?? 200}
  `);
  return r.rows.map((row) => ({
    id: String(row['id']),
    source_id: row['source_id'] ? String(row['source_id']) : null,
    worker: String(row['worker']),
    error_class: String(row['error_class']),
    reason: String(row['reason']),
    retry_count: Number(row['retry_count']),
    first_seen: String(row['first_seen']),
    last_attempt: String(row['last_attempt']),
    resolved_at: row['resolved_at'] ? String(row['resolved_at']) : null,
  }));
}

export async function markResolved(id: string, reason: string): Promise<void> {
  await batchDeadLetterUpdate('resolve', [id], reason);
}

export async function incrementRetry(id: string): Promise<void> {
  await batchDeadLetterUpdate('retry', [id]);
}

/**
 * AUDIT-005: typed error raised when a dead-letter batch matched no
 * rows. The route maps this to HTTP 404 so an operator clicking
 * "retry" on a stale UI doesn't silently get a 200 with `count: 0`.
 */
export class DeadLetterNotFoundError extends Error {
  override readonly name = 'DeadLetterNotFoundError';
  readonly requestedIds: ReadonlyArray<string>;
  readonly action: 'resolve' | 'retry';
  constructor(action: 'resolve' | 'retry', requestedIds: ReadonlyArray<string>) {
    super(
      `dead_letter ${action} matched zero rows for ids ${requestedIds.slice(0, 5).join(', ')}${
        requestedIds.length > 5 ? `, +${requestedIds.length - 5} more` : ''
      }`,
    );
    this.requestedIds = requestedIds;
    this.action = action;
  }
}

/**
 * AUDIT-004: atomic multi-row dead-letter update.
 *
 * The earlier route layer issued `Promise.all(ids.map(markResolved))` —
 * N parallel UPDATEs without a transaction. A partial failure (e.g.,
 * one of the N rows hit a serialization conflict) left the table in
 * mixed state while the route still returned 200 OK with `count: N`.
 *
 * The new contract: a single `UPDATE ... WHERE id = ANY($1::uuid[])
 * RETURNING id`. Atomic by definition, one round-trip, returns the
 * exact set of IDs the database actually touched.
 *
 * AUDIT-005: throws DeadLetterNotFoundError when ZERO rows matched.
 * Partial matches (some-but-not-all) are surfaced via the returned
 * `affected` set; the route compares `affected.length` to the
 * requested length and reports both.
 */
export async function batchDeadLetterUpdate(
  action: 'resolve' | 'retry',
  ids: ReadonlyArray<string>,
  reason?: string,
): Promise<{ affected: ReadonlyArray<string> }> {
  if (ids.length === 0) {
    throw new Error('batchDeadLetterUpdate: ids must be non-empty');
  }
  const db = await getDb();
  const idsArray = sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]`;
  const r =
    action === 'resolve'
      ? await db.execute(sql`
          UPDATE source.dead_letter
             SET resolved_at = NOW(),
                 resolved_reason = ${reason ?? 'manual-resolve'}
           WHERE id = ANY(${idsArray})
         RETURNING id::text
        `)
      : await db.execute(sql`
          UPDATE source.dead_letter
             SET retry_count = retry_count + 1,
                 last_attempt = NOW()
           WHERE id = ANY(${idsArray})
         RETURNING id::text
        `);
  const affected = r.rows.map((row) => String((row as Record<string, unknown>)['id']));
  if (affected.length === 0) {
    throw new DeadLetterNotFoundError(action, ids);
  }
  return { affected };
}
