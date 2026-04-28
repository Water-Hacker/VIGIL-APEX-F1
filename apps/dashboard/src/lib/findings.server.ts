import 'server-only';

import { FindingRepo, getDb } from '@vigil/db-postgres';
import { sql } from 'drizzle-orm';

let cachedRepo: FindingRepo | null = null;

async function repo(): Promise<FindingRepo> {
  if (cachedRepo) return cachedRepo;
  const db = await getDb();
  cachedRepo = new FindingRepo(db);
  return cachedRepo;
}

export interface FindingListRow {
  readonly id: string;
  readonly title_fr: string;
  readonly title_en: string;
  readonly severity: string;
  readonly posterior: number | null;
  readonly state: string;
  readonly detected_at: string;
}

export async function listFindings(opts: { limit?: number; threshold?: number }): Promise<FindingListRow[]> {
  const r = await repo();
  // Bypass the typed repo for a quick cross-cut listing
  const db = await getDb();
  const result = await db.execute(sql`
    SELECT id, title_fr, title_en, severity, posterior, state, detected_at::text
      FROM finding.finding
     WHERE posterior >= ${opts.threshold ?? 0.5}
       AND state IN ('detected','review','council_review','escalated')
     ORDER BY detected_at DESC
     LIMIT ${opts.limit ?? 50}
  `);
  void r;
  return result.rows.map((row) => ({
    id: String(row['id']),
    title_fr: String(row['title_fr']),
    title_en: String(row['title_en']),
    severity: String(row['severity']),
    posterior: row['posterior'] !== null ? Number(row['posterior']) : null,
    state: String(row['state']),
    detected_at: String(row['detected_at']),
  }));
}
