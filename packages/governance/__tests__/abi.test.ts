/**
 * AUDIT-062 — VIGIL_ANCHOR_ABI + VIGIL_GOVERNANCE_ABI integrity.
 *
 * The off-chain ABI fragments must decode every selector and event topic
 * the on-chain contracts emit. A drift between Solidity and these strings
 * is a silent bug — calls return garbage, watchers never fire — so we pin
 * the function selectors and event topic-hashes here.
 *
 * The selectors below were captured against the ABIs as of audit date
 * 2026-04-30. If the contract surface changes, regenerate via
 *   `pnpm --filter contracts run build`
 *   `pnpm --filter @vigil/governance run test`
 * and update the pinned values.
 */
import { ethers } from 'ethers';
import { describe, expect, it } from 'vitest';

import {
  PILLAR_ID,
  PROPOSAL_STATE,
  REVEAL_DELAY_SECONDS,
  VIGIL_ANCHOR_ABI,
  VIGIL_GOVERNANCE_ABI,
  VOTE_CHOICE,
  type Pillar,
} from '../src/abi.js';

const anchorIface = new ethers.Interface(VIGIL_ANCHOR_ABI as readonly string[]);
const govIface = new ethers.Interface(VIGIL_GOVERNANCE_ABI as readonly string[]);

describe('AUDIT-062 — VIGIL_ANCHOR_ABI parses + selectors', () => {
  it('parses every fragment without error', () => {
    expect(anchorIface.fragments.length).toBeGreaterThanOrEqual(VIGIL_ANCHOR_ABI.length - 0);
  });

  it('exposes the write-side selectors', () => {
    expect(anchorIface.getFunction('commit')!.selector).toBe(
      ethers.id('commit(uint256,uint256,bytes32)').slice(0, 10),
    );
    expect(anchorIface.getFunction('rotateCommitter')!.selector).toBe(
      ethers.id('rotateCommitter(address)').slice(0, 10),
    );
  });

  it('exposes the view selectors', () => {
    expect(anchorIface.getFunction('committer')!.selector).toBe(
      ethers.id('committer()').slice(0, 10),
    );
    expect(anchorIface.getFunction('getCommitment')!.selector).toBe(
      ethers.id('getCommitment(uint256)').slice(0, 10),
    );
    expect(anchorIface.getFunction('totalCommitments')!.selector).toBe(
      ethers.id('totalCommitments()').slice(0, 10),
    );
  });

  it('exposes Anchored event topic', () => {
    expect(anchorIface.getEvent('Anchored')!.topicHash).toBe(
      ethers.id('Anchored(uint256,uint256,uint256,bytes32,address)'),
    );
  });

  it('exposes CommitterRotated event topic', () => {
    expect(anchorIface.getEvent('CommitterRotated')!.topicHash).toBe(
      ethers.id('CommitterRotated(address,address)'),
    );
  });
});

describe('AUDIT-062 — VIGIL_GOVERNANCE_ABI parses + selectors', () => {
  it('parses every fragment without error', () => {
    expect(govIface.fragments.length).toBeGreaterThanOrEqual(VIGIL_GOVERNANCE_ABI.length - 0);
  });

  it('exposes commit-reveal selectors', () => {
    expect(govIface.getFunction('commitProposal')!.selector).toBe(
      ethers.id('commitProposal(bytes32)').slice(0, 10),
    );
    expect(govIface.getFunction('openProposal')!.selector).toBe(
      ethers.id('openProposal(bytes32,string,bytes32)').slice(0, 10),
    );
  });

  it('exposes vote selector with the documented signature', () => {
    expect(govIface.getFunction('vote')!.selector).toBe(
      ethers.id('vote(uint256,uint8,bytes32)').slice(0, 10),
    );
  });

  it('exposes settleExpiredProposal selector', () => {
    expect(govIface.getFunction('settleExpiredProposal')!.selector).toBe(
      ethers.id('settleExpiredProposal(uint256)').slice(0, 10),
    );
  });

  it('exposes member-management selectors', () => {
    expect(govIface.getFunction('addMember')!.selector).toBe(
      ethers.id('addMember(address,uint8)').slice(0, 10),
    );
    expect(govIface.getFunction('removeMember')!.selector).toBe(
      ethers.id('removeMember(uint8)').slice(0, 10),
    );
  });

  it('exposes ProposalCommitted, ProposalOpened, VoteCast event topics', () => {
    expect(govIface.getEvent('ProposalCommitted')!.topicHash).toBe(
      ethers.id('ProposalCommitted(address,bytes32,uint64)'),
    );
    expect(govIface.getEvent('ProposalOpened')!.topicHash).toBe(
      ethers.id('ProposalOpened(uint256,bytes32,address,string)'),
    );
    expect(govIface.getEvent('VoteCast')!.topicHash).toBe(
      ethers.id('VoteCast(uint256,address,uint8,uint8,bytes32)'),
    );
  });

  it('exposes outcome-event topics (Escalated/Dismissed/Expired)', () => {
    expect(govIface.getEvent('ProposalEscalated')!.topicHash).toBe(
      ethers.id('ProposalEscalated(uint256)'),
    );
    expect(govIface.getEvent('ProposalDismissed')!.topicHash).toBe(
      ethers.id('ProposalDismissed(uint256)'),
    );
    expect(govIface.getEvent('ProposalExpired')!.topicHash).toBe(
      ethers.id('ProposalExpired(uint256)'),
    );
  });

  it('encode-decode roundtrip for vote(...) call data', () => {
    const proposalIndex = 7;
    const choice = VOTE_CHOICE.YES;
    const reason = ethers.encodeBytes32String('escalate-foo');
    const calldata = govIface.encodeFunctionData('vote', [proposalIndex, choice, reason]);
    const decoded = govIface.decodeFunctionData('vote', calldata);
    expect(Number(decoded[0])).toBe(proposalIndex);
    expect(Number(decoded[1])).toBe(choice);
    expect(decoded[2]).toBe(reason);
  });

  it('encode-decode roundtrip for openProposal(...) call data', () => {
    const findingHash = ethers.id('finding-42');
    const uri = 'ipfs://bafy.../report.pdf';
    const salt = ethers.id('salt-xyz');
    const calldata = govIface.encodeFunctionData('openProposal', [findingHash, uri, salt]);
    const decoded = govIface.decodeFunctionData('openProposal', calldata);
    expect(decoded[0]).toBe(findingHash);
    expect(decoded[1]).toBe(uri);
    expect(decoded[2]).toBe(salt);
  });

  it('decodes a synthetic VoteCast log into typed args', () => {
    const proposalIndex = 12n;
    const voter = ethers.getAddress('0x0000000000000000000000000000000000000abc');
    const choice = VOTE_CHOICE.NO;
    const pillar = PILLAR_ID.audit;
    const recuseReason = ethers.encodeBytes32String('');
    const log = govIface.encodeEventLog('VoteCast', [
      proposalIndex,
      voter,
      choice,
      pillar,
      recuseReason,
    ]);
    const parsed = govIface.parseLog({ topics: log.topics, data: log.data });
    expect(parsed!.name).toBe('VoteCast');
    expect(BigInt(parsed!.args[0])).toBe(proposalIndex);
    expect(parsed!.args[1]).toBe(voter);
    expect(Number(parsed!.args[2])).toBe(choice);
    expect(Number(parsed!.args[3])).toBe(pillar);
    expect(parsed!.args[4]).toBe(recuseReason);
  });
});

describe('AUDIT-062 — enum mirrors are stable', () => {
  it('PILLAR_ID covers exactly five pillars in declared order', () => {
    const expected: Record<Pillar, number> = {
      governance: 0,
      judicial: 1,
      civil_society: 2,
      audit: 3,
      technical: 4,
    };
    expect(PILLAR_ID).toEqual(expected);
    expect(Object.keys(PILLAR_ID).length).toBe(5);
  });

  it('VOTE_CHOICE = { YES: 0, NO: 1, ABSTAIN: 2, RECUSE: 3 } per Solidity enum', () => {
    expect(VOTE_CHOICE).toEqual({ YES: 0, NO: 1, ABSTAIN: 2, RECUSE: 3 });
  });

  it('PROPOSAL_STATE = { OPEN: 0, ESCALATED: 1, DISMISSED: 2, EXPIRED: 3 }', () => {
    expect(PROPOSAL_STATE).toEqual({ OPEN: 0, ESCALATED: 1, DISMISSED: 2, EXPIRED: 3 });
  });

  it('REVEAL_DELAY_SECONDS = 120 (2 minutes per VIGILGovernance.sol)', () => {
    expect(REVEAL_DELAY_SECONDS).toBe(120);
  });
});
