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
  const db = await getDb();
  await db.execute(sql`
    UPDATE source.dead_letter
       SET resolved_at = NOW(), resolved_reason = ${reason}
     WHERE id = ${id}::uuid
  `);
}

export async function incrementRetry(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(sql`
    UPDATE source.dead_letter
       SET retry_count = retry_count + 1, last_attempt = NOW()
     WHERE id = ${id}::uuid
  `);
}
