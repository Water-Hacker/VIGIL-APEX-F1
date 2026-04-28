import 'server-only';

import { getDb } from '@vigil/db-postgres';
import { sql } from 'drizzle-orm';

export interface AdapterRepairProposal {
  readonly id: string;
  readonly source_id: string;
  readonly candidate_selector: unknown;
  readonly rationale: string | null;
  readonly generated_at: string;
  readonly generated_by_llm: string;
  readonly status: string;
  readonly shadow_count: number;
  readonly shadow_match_rate: number | null;
  readonly shadow_divergence_rate: number | null;
}

export async function listPendingProposals(): Promise<AdapterRepairProposal[]> {
  const db = await getDb();
  const r = await db.execute(sql`
    SELECT p.id::text,
           p.source_id,
           p.candidate_selector,
           p.rationale,
           p.generated_at::text,
           p.generated_by_llm,
           p.status,
           COALESCE(s.cnt, 0)         AS shadow_count,
           s.match_rate               AS shadow_match_rate,
           s.divergence_rate          AS shadow_divergence_rate
      FROM source.adapter_repair_proposal p
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt,
               (SUM(CASE WHEN new_match  THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS match_rate,
               (SUM(CASE WHEN divergence THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS divergence_rate
          FROM source.adapter_repair_shadow_log
         WHERE proposal_id = p.id
      ) s ON TRUE
     WHERE p.status IN ('shadow_testing', 'awaiting_approval')
     ORDER BY p.generated_at DESC
  `);
  return r.rows.map((row) => ({
    id: String(row['id']),
    source_id: String(row['source_id']),
    candidate_selector: row['candidate_selector'],
    rationale: row['rationale'] ? String(row['rationale']) : null,
    generated_at: String(row['generated_at']),
    generated_by_llm: String(row['generated_by_llm']),
    status: String(row['status']),
    shadow_count: Number(row['shadow_count']),
    shadow_match_rate:
      row['shadow_match_rate'] === null ? null : Number(row['shadow_match_rate']),
    shadow_divergence_rate:
      row['shadow_divergence_rate'] === null ? null : Number(row['shadow_divergence_rate']),
  }));
}

export async function decideProposal(
  id: string,
  decision: 'promoted' | 'rejected',
  decidedBy: string,
  reason?: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(sql`
    UPDATE source.adapter_repair_proposal
       SET status         = ${decision},
           decided_at     = NOW(),
           decided_by     = ${decidedBy},
           decision_reason = ${reason ?? null}
     WHERE id = ${id}::uuid
       AND status IN ('shadow_testing', 'awaiting_approval')
  `);

  if (decision === 'promoted') {
    // Flip the live selector by writing into adapter_selector_registry.
    // The adapter-runner reads it on every run cycle.
    await db.execute(sql`
      UPDATE source.adapter_selector_registry r
         SET selector   = p.candidate_selector,
             updated_at = NOW(),
             updated_by = ${`approve:${decidedBy}`}
        FROM source.adapter_repair_proposal p
       WHERE p.id = ${id}::uuid AND r.source_id = p.source_id
    `);
  }
}
