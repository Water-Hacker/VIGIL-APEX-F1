/**
 * Tier-45 audit closure — Ethereum address case-normalisation in
 * vote-ceremony audit-chain `actor` field.
 *
 * Pre-fix:
 *   - `handleVoteCast` lowercased the address for the DB projection
 *     (`vote.voter_address: voter.toLowerCase()`) but kept the raw
 *     mixed-case form for the audit-chain `actor` field. So one
 *     identity ended up represented two ways across two storage
 *     surfaces:
 *       - vote.voter_address: "0xa1a1a1...a1" (lowercase)
 *       - audit.actions.actor: "0xA1A1A1...A1" (checksummed/mixed)
 *   - `handleProposalOpened` never lowercased proposer at all.
 *
 * Operational impact: an audit-chain forensic query like
 * "show me every audit row authored by 0xa1...a1" had to do a
 * case-insensitive scan and cross-join against the vote table to
 * cover both cases. Bugs in such queries can silently miss rows.
 *
 * Post-fix: BOTH handlers lowercase the address BEFORE recording. The
 * audit chain's `actor` field and the vote table's `voter_address`
 * column hold byte-identical values for the same on-chain identity.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  handleProposalOpened,
  handleVoteCast,
  type VoteCeremonyDeps,
} from '../src/vote-ceremony.js';

const FROZEN_NOW = new Date('2026-05-02T16:00:00Z');
const ZERO_BYTES32 = '0x'.padEnd(66, '0');

function makeDeps(): {
  deps: VoteCeremonyDeps;
  chainAppend: ReturnType<typeof vi.fn>;
  insertProposal: ReturnType<typeof vi.fn>;
  insertVote: ReturnType<typeof vi.fn>;
} {
  const chainAppend = vi.fn(async (_row: Record<string, unknown>) => ({ seq: 1 }));
  const insertProposal = vi.fn(async (_row: Record<string, unknown>) => undefined);
  const insertVote = vi.fn(async (_row: Record<string, unknown>) => undefined);
  const noop = vi.fn();
  const logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => logger,
  } as never;
  return {
    deps: {
      repo: { insertProposal, insertVote } as never,
      findingRepo: { getById: vi.fn() } as never,
      dossierRepo: {} as never,
      chain: { append: chainAppend } as never,
      queue: { publish: vi.fn() } as never,
      logger,
      now: () => FROZEN_NOW,
    },
    chainAppend,
    insertProposal,
    insertVote,
  };
}

describe('Tier-45 — handleProposalOpened lowercases proposer in actor field', () => {
  it('uppercase-input proposer is lowercased in audit-chain actor', async () => {
    const { deps, chainAppend } = makeDeps();
    const PROPOSER_MIXED = '0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd';
    await handleProposalOpened(
      deps,
      42,
      '0xfeed'.padEnd(66, 'f'),
      PROPOSER_MIXED,
      '0xbeef'.padEnd(66, 'b'),
    );
    expect(chainAppend).toHaveBeenCalledTimes(1);
    const row = chainAppend.mock.calls[0]![0] as { actor: string; action: string };
    expect(row.action).toBe('governance.proposal_opened');
    expect(row.actor).toBe(PROPOSER_MIXED.toLowerCase());
    // Belt and braces: assert the actor really IS all-lowercase (no
    // mixed case anywhere).
    expect(row.actor).toBe(row.actor.toLowerCase());
  });

  it('already-lowercase input is a no-op (passes through unchanged)', async () => {
    const { deps, chainAppend } = makeDeps();
    const PROPOSER_LC = '0x' + 'a'.repeat(40);
    await handleProposalOpened(
      deps,
      42,
      '0xfeed'.padEnd(66, 'f'),
      PROPOSER_LC,
      '0xbeef'.padEnd(66, 'b'),
    );
    expect((chainAppend.mock.calls[0]![0] as { actor: string }).actor).toBe(PROPOSER_LC);
  });
});

describe('Tier-45 — handleVoteCast lowercases voter consistently across projection + audit', () => {
  it('audit-chain actor matches DB projection voter_address exactly (byte-identical)', async () => {
    const { deps, chainAppend, insertVote } = makeDeps();
    const VOTER_MIXED = '0xAaBbCcDdEeFfAaBbCcDdEeFfAaBbCcDdEeFfAaBb';
    await handleVoteCast(deps, 42, VOTER_MIXED, /*YES*/ 0, /*governance*/ 0, ZERO_BYTES32);

    expect(insertVote).toHaveBeenCalledTimes(1);
    const voteRow = insertVote.mock.calls[0]![0] as { voter_address: string };
    expect(chainAppend).toHaveBeenCalledTimes(1);
    const auditRow = chainAppend.mock.calls[0]![0] as { actor: string; action: string };
    expect(auditRow.action).toBe('governance.vote_cast');

    // The core tier-45 assertion: SAME byte representation.
    expect(auditRow.actor).toBe(voteRow.voter_address);
    expect(auditRow.actor).toBe(VOTER_MIXED.toLowerCase());
  });

  it('out-of-range choice still triggers the tier-12 guard (refuses projection)', async () => {
    // Sanity-check that the tier-45 address normalisation didn't accidentally
    // weaken the tier-12 enum guard.
    const { deps, chainAppend, insertVote } = makeDeps();
    await handleVoteCast(deps, 42, '0xabcd', /*invalid choice*/ 99, 0, ZERO_BYTES32);
    expect(insertVote).not.toHaveBeenCalled();
    expect(chainAppend).not.toHaveBeenCalled();
  });
});
