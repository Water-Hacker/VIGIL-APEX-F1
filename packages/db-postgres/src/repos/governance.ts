import { and, desc, eq, sql } from 'drizzle-orm';

import { clampRepoLimit } from '../limit-cap.js';
import * as govSchema from '../schema/governance.js';

import type { Db } from '../client.js';

export class GovernanceRepo {
  constructor(private readonly db: Db) {}

  async listActiveMembers() {
    return this.db.select().from(govSchema.member).where(eq(govSchema.member.is_active, true));
  }

  async upsertMember(row: typeof govSchema.member.$inferInsert): Promise<void> {
    await this.db
      .insert(govSchema.member)
      .values(row)
      .onConflictDoUpdate({
        target: govSchema.member.eth_address,
        set: {
          pillar: row.pillar,
          display_name: row.display_name,
          enrolled_at: row.enrolled_at,
          bio_fr: row.bio_fr,
          bio_en: row.bio_en,
          ...(row.yubikey_serial !== undefined && { yubikey_serial: row.yubikey_serial }),
          ...(row.yubikey_aaguid !== undefined && { yubikey_aaguid: row.yubikey_aaguid }),
          ...(row.resigned_at !== undefined && { resigned_at: row.resigned_at }),
          ...(row.is_active !== undefined && { is_active: row.is_active }),
        },
      });
  }

  async insertProposal(row: typeof govSchema.proposal.$inferInsert): Promise<void> {
    await this.db.insert(govSchema.proposal).values(row);
  }

  async insertVote(row: typeof govSchema.vote.$inferInsert): Promise<void> {
    // Tier-27 audit closure: previous insert + UPDATE were two separate
    // statements outside a transaction. INSERT succeeding then UPDATE
    // failing left a vote row with the counter un-incremented (the
    // vote row referencing proposal_id existed, but the proposal's
    // running tally was stale). Wrap both in a tx so the pair is
    // atomic.
    await this.db.transaction(async (tx) => {
      await tx.insert(govSchema.vote).values(row);

      // Tier-27 audit closure: previous code built the column name by
      // string-templating `${row.choice.toLowerCase()}_votes` and
      // passing it through `sql.raw` — drizzle's "interpolate
      // literally, never quote" hand-grenade. With the type system
      // bypassed (`as never` cast at a caller, schema drift, or new
      // vote-choice added without updating this site) it was a clean
      // SQL-injection surface. Replaced with an enum→drizzle-column
      // map so the column reference is statically typed against the
      // schema and `sql.raw` is no longer reachable from this path.
      const choice = String(row.choice).toLowerCase();
      const colByChoice = {
        yes: govSchema.proposal.yes_votes,
        no: govSchema.proposal.no_votes,
        abstain: govSchema.proposal.abstain_votes,
        recuse: govSchema.proposal.recuse_votes,
      } as const;
      const col = (colByChoice as Record<string, (typeof colByChoice)[keyof typeof colByChoice]>)[
        choice
      ];
      if (!col) {
        throw new Error(`unknown vote choice: ${JSON.stringify(row.choice)}`);
      }
      await tx
        .update(govSchema.proposal)
        .set({ [col.name]: sql`${col} + 1` })
        .where(eq(govSchema.proposal.id, row.proposal_id));
    });
  }

  async openProposals(limit = 50) {
    return this.db
      .select()
      .from(govSchema.proposal)
      .where(eq(govSchema.proposal.state, 'open'))
      .orderBy(desc(govSchema.proposal.opened_at))
      .limit(clampRepoLimit(limit));
  }

  async getProposalById(id: string) {
    const rows = await this.db
      .select()
      .from(govSchema.proposal)
      .where(eq(govSchema.proposal.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** DECISION-010 — used by worker-governance to resolve finding_id from
   *  the contract's on-chain index when an escalation event arrives. */
  async getProposalByOnChainIndex(onChainIndex: string) {
    const rows = await this.db
      .select()
      .from(govSchema.proposal)
      .where(eq(govSchema.proposal.on_chain_index, onChainIndex))
      .limit(1);
    return rows[0] ?? null;
  }

  async getVote(proposalId: string, voterAddress: string) {
    const rows = await this.db
      .select()
      .from(govSchema.vote)
      .where(
        and(
          eq(govSchema.vote.proposal_id, proposalId),
          eq(govSchema.vote.voter_address, voterAddress),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async getActiveMemberByAddress(voterAddress: string) {
    const rows = await this.db
      .select()
      .from(govSchema.member)
      .where(
        and(
          eq(govSchema.member.eth_address, voterAddress.toLowerCase()),
          eq(govSchema.member.is_active, true),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async insertWebauthnChallenge(
    row: typeof govSchema.webauthnChallenge.$inferInsert,
  ): Promise<void> {
    await this.db.insert(govSchema.webauthnChallenge).values(row);
  }

  async findOpenWebauthnChallenge(proposalId: string, voterAddress: string) {
    const rows = await this.db
      .select()
      .from(govSchema.webauthnChallenge)
      .where(
        and(
          eq(govSchema.webauthnChallenge.proposal_id, proposalId),
          eq(govSchema.webauthnChallenge.voter_address, voterAddress.toLowerCase()),
        ),
      )
      .orderBy(sql`issued_at DESC`)
      .limit(1);
    const row = rows[0] ?? null;
    if (!row) return null;
    if (row.consumed_at !== null) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    return row;
  }

  async consumeWebauthnChallenge(id: string): Promise<void> {
    await this.db
      .update(govSchema.webauthnChallenge)
      .set({ consumed_at: new Date() })
      .where(eq(govSchema.webauthnChallenge.id, id));
  }

  async bumpWebauthnCounter(memberId: string, newCounter: number): Promise<void> {
    await this.db
      .update(govSchema.member)
      .set({ webauthn_counter: newCounter })
      .where(eq(govSchema.member.id, memberId));
  }
}
