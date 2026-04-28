import { and, desc, eq, sql } from 'drizzle-orm';

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
          yubikey_serial: row.yubikey_serial,
          yubikey_aaguid: row.yubikey_aaguid,
          enrolled_at: row.enrolled_at,
          resigned_at: row.resigned_at,
          bio_fr: row.bio_fr,
          bio_en: row.bio_en,
          is_active: row.is_active,
        },
      });
  }

  async insertProposal(row: typeof govSchema.proposal.$inferInsert): Promise<void> {
    await this.db.insert(govSchema.proposal).values(row);
  }

  async insertVote(row: typeof govSchema.vote.$inferInsert): Promise<void> {
    await this.db.insert(govSchema.vote).values(row);
    // Increment counters on the proposal
    const choiceCol = `${row.choice.toLowerCase()}_votes` as const;
    await this.db.execute(
      sql`UPDATE governance.proposal
              SET ${sql.raw(choiceCol)} = ${sql.raw(choiceCol)} + 1
            WHERE id = ${row.proposal_id}`,
    );
  }

  async openProposals(limit = 50) {
    return this.db
      .select()
      .from(govSchema.proposal)
      .where(eq(govSchema.proposal.state, 'open'))
      .orderBy(desc(govSchema.proposal.opened_at))
      .limit(limit);
  }
}
