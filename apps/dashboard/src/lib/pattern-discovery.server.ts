import 'server-only';

import { PatternDiscoveryRepo, getDb } from '@vigil/db-postgres';

let cached: PatternDiscoveryRepo | null = null;

async function repo(): Promise<PatternDiscoveryRepo> {
  if (cached) return cached;
  const db = await getDb();
  cached = new PatternDiscoveryRepo(db);
  return cached;
}

export interface DiscoveryCandidateView {
  readonly id: string;
  readonly kind: string;
  readonly strength: number;
  readonly entity_ids_involved: ReadonlyArray<string>;
  readonly rationale: string;
  readonly evidence: Record<string, unknown>;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
}

export async function listAwaitingCuration(
  limit = 50,
): Promise<ReadonlyArray<DiscoveryCandidateView>> {
  const r = await repo();
  const rows = await r.listAwaitingCuration(limit);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    strength: Number(row.strength),
    entity_ids_involved: row.entity_ids_involved,
    rationale: row.rationale,
    evidence: row.evidence as Record<string, unknown>,
    first_seen_at: row.first_seen_at.toISOString(),
    last_seen_at: row.last_seen_at.toISOString(),
  }));
}

export async function curateCandidate(input: {
  readonly id: string;
  readonly decision: 'promoted' | 'dismissed' | 'merged';
  readonly actor: string;
  readonly notes?: string;
}): Promise<void> {
  const r = await repo();
  await r.setCuration({
    id: input.id,
    status: input.decision,
    curated_by: input.actor,
    decision: input.decision,
    ...(input.notes ? { notes: input.notes } : {}),
  });
}
