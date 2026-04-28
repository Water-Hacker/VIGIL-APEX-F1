import { z } from 'zod';

import { zEthAddress, zIsoInstant, zPillar, zUuid } from './common.js';

/* =============================================================================
 * Governance — proposals, votes, members. SRD §23.
 *
 * Mirrored from on-chain VIGILGovernance contract events; Postgres holds a
 * read-optimised projection. The chain is authoritative.
 * ===========================================================================*/

export const zVoteChoice = z.enum(['YES', 'NO', 'ABSTAIN', 'RECUSE']);
export type VoteChoice = z.infer<typeof zVoteChoice>;

export const zProposalState = z.enum([
  'open',
  'escalated', // 3-of-5 YES
  'dismissed', // 3-of-5 NO
  'expired',   // 14-day window passed
]);
export type ProposalState = z.infer<typeof zProposalState>;

export const zCouncilMember = z.object({
  id: zUuid,
  pillar: zPillar,
  display_name: z.string().min(1).max(200),
  eth_address: zEthAddress,
  yubikey_serial: z.string().min(4).max(40).nullable(),
  yubikey_aaguid: z.string().min(8).max(80).nullable(),
  enrolled_at: zIsoInstant,
  resigned_at: zIsoInstant.nullable(),
  bio_fr: z.string().max(2_000),
  bio_en: z.string().max(2_000),
  is_active: z.boolean(),
});
export type CouncilMember = z.infer<typeof zCouncilMember>;

export const zProposal = z.object({
  id: zUuid,
  on_chain_index: z.string().min(1).max(80), // uint256 as decimal
  finding_id: zUuid,
  dossier_id: zUuid.nullable(),
  state: zProposalState,
  opened_at: zIsoInstant,
  closes_at: zIsoInstant,
  closed_at: zIsoInstant.nullable(),
  yes_votes: z.number().int().min(0).max(5),
  no_votes: z.number().int().min(0).max(5),
  abstain_votes: z.number().int().min(0).max(5),
  recuse_votes: z.number().int().min(0).max(5),
  /** Block-level chain references for audit. */
  proposal_tx_hash: z.string().regex(/^0x[a-f0-9]{64}$/i).nullable(),
  closing_tx_hash: z.string().regex(/^0x[a-f0-9]{64}$/i).nullable(),
});
export type Proposal = z.infer<typeof zProposal>;

export const zVote = z.object({
  id: zUuid,
  proposal_id: zUuid,
  voter_address: zEthAddress,
  voter_pillar: zPillar,
  choice: zVoteChoice,
  cast_at: zIsoInstant,
  vote_tx_hash: z.string().regex(/^0x[a-f0-9]{64}$/i),
  recuse_reason: z.string().max(500).nullable(),
});
export type Vote = z.infer<typeof zVote>;
