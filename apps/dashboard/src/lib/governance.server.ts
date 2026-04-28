import 'server-only';

import { GovernanceRepo, getDb } from '@vigil/db-postgres';

export async function listOpenProposals(): Promise<
  Array<{
    id: string;
    on_chain_index: string;
    finding_id: string;
    opened_at: string;
    closes_at: string;
    yes_votes: number;
    no_votes: number;
    abstain_votes: number;
    recuse_votes: number;
  }>
> {
  const db = await getDb();
  const repo = new GovernanceRepo(db);
  const rows = await repo.openProposals();
  return rows.map((r) => ({
    id: r.id,
    on_chain_index: r.on_chain_index,
    finding_id: r.finding_id,
    opened_at: r.opened_at.toISOString(),
    closes_at: r.closes_at.toISOString(),
    yes_votes: r.yes_votes,
    no_votes: r.no_votes,
    abstain_votes: r.abstain_votes,
    recuse_votes: r.recuse_votes,
  }));
}
