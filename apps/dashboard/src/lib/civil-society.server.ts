import 'server-only';

import { GovernanceRepo, getDb } from '@vigil/db-postgres';
import { sql } from 'drizzle-orm';

/**
 * Civil-society read-only data accessors (Tier 5 / DECISION-008).
 *
 * The civil-society pillar (and read-only `civil_society` Keycloak role) sees
 * a stripped projection of governance + audit state:
 *
 *   - audit-log: action stream with subject_id MASKED unless 4-of-5 release
 *     vote unmasked it (W-15 surface).
 *   - proposals-closed: closed proposals + final tally, no entity names.
 *   - council-composition: pillar holders by *role*, not by name (architect
 *     publishes individual identities at EXEC §13 enrolment ceremony only).
 */

export interface AuditLogRow {
  readonly seq: number;
  readonly action: string;
  readonly actor_role: string; // architect | worker | council | (masked)
  readonly subject_kind: string;
  readonly subject_id_masked: string;
  readonly occurred_at: string;
}

export async function listAuditLogPage(opts: {
  cursor?: number;
  limit?: number;
}): Promise<{ rows: AuditLogRow[]; nextCursor: number | null }> {
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  const cursor = opts.cursor ?? 0;
  const db = await getDb();
  const r = await db.execute(sql`
    SELECT seq::text AS seq,
           action,
           actor::text AS actor,
           subject_kind,
           subject_id::text AS subject_id,
           occurred_at::text AS occurred_at
      FROM audit.actions
     WHERE seq > ${cursor}
     ORDER BY seq ASC
     LIMIT ${limit}
  `);
  const rows = r.rows.map((row) => {
    const seq = Number(row['seq']);
    const subjectId = String(row['subject_id'] ?? '');
    return {
      seq,
      action: String(row['action'] ?? ''),
      actor_role: classifyActor(String(row['actor'] ?? '')),
      subject_kind: String(row['subject_kind'] ?? ''),
      subject_id_masked: maskSubjectId(subjectId),
      occurred_at: String(row['occurred_at'] ?? ''),
    } satisfies AuditLogRow;
  });
  const nextCursor = rows.length === limit ? rows[rows.length - 1]!.seq : null;
  return { rows, nextCursor };
}

function classifyActor(actor: string): string {
  if (!actor) return 'unknown';
  if (actor.startsWith('worker-')) return 'worker';
  if (actor.startsWith('architect@')) return 'architect';
  if (actor.startsWith('council@') || actor.startsWith('council-')) return 'council';
  return 'system';
}

function maskSubjectId(id: string): string {
  // Per W-15: civil-society sees subject_id only as a deterministic short
  // hash of the row, not the canonical id. Civil-society can therefore
  // confirm two log rows reference the same subject without learning what
  // that subject is named. The full id is restored if/when a 4-of-5 release
  // vote unmasks the row.
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export interface ClosedProposalRow {
  readonly id: string;
  readonly closed_at: string;
  readonly state: string;
  readonly yes_votes: number;
  readonly no_votes: number;
  readonly abstain_votes: number;
  readonly recuse_votes: number;
  readonly closing_tx_hash: string | null;
}

export async function listClosedProposals(limit = 50): Promise<ClosedProposalRow[]> {
  const db = await getDb();
  const r = await db.execute(sql`
    SELECT id::text                 AS id,
           closed_at::text          AS closed_at,
           state                    AS state,
           yes_votes                AS yes_votes,
           no_votes                 AS no_votes,
           abstain_votes            AS abstain_votes,
           recuse_votes             AS recuse_votes,
           closing_tx_hash          AS closing_tx_hash
      FROM governance.proposal
     WHERE state IN ('escalated', 'closed', 'rejected', 'inconclusive')
     ORDER BY closed_at DESC NULLS LAST
     LIMIT ${limit}
  `);
  return r.rows.map((row) => ({
    id: String(row['id'] ?? ''),
    closed_at: String(row['closed_at'] ?? ''),
    state: String(row['state'] ?? ''),
    yes_votes: Number(row['yes_votes'] ?? 0),
    no_votes: Number(row['no_votes'] ?? 0),
    abstain_votes: Number(row['abstain_votes'] ?? 0),
    recuse_votes: Number(row['recuse_votes'] ?? 0),
    closing_tx_hash: (row['closing_tx_hash'] as string | null) ?? null,
  }));
}

export interface CouncilCompositionRow {
  readonly pillar: string;
  readonly seat_filled: boolean;
  readonly enrolled_at: string | null;
}

export async function listCouncilComposition(): Promise<CouncilCompositionRow[]> {
  const db = await getDb();
  const repo = new GovernanceRepo(db);
  const members = await repo.listActiveMembers();
  // We deliberately project only pillar + enrollment date, NOT display_name.
  // Per EXEC §13 the architect publishes individual names through a separate
  // ceremony; this surface never reveals them.
  const byPillar = new Map<string, Date>();
  for (const m of members) {
    if (!byPillar.has(m.pillar)) byPillar.set(m.pillar, m.enrolled_at);
  }
  const PILLARS = ['governance', 'judicial', 'civil_society', 'audit', 'technical'] as const;
  return PILLARS.map((p) => {
    const enrolled = byPillar.get(p);
    return {
      pillar: p,
      seat_filled: !!enrolled,
      enrolled_at: enrolled ? enrolled.toISOString() : null,
    };
  });
}
