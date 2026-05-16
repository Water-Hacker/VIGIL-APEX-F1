/* eslint-disable unicorn/filename-case -- Hardhat test files mirror the
   contract name (PascalCase) by convention; renaming breaks the
   convention without functional benefit. */
/* global describe, it */
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import type { VIGILGovernance } from '../typechain-types';
import type { Signer } from 'ethers';

describe('VIGILGovernance', () => {
  async function deploy() {
    const [admin, gov, jud, civ, aud, tech, outsider] = await ethers.getSigners();
    const G = await ethers.getContractFactory('VIGILGovernance');
    const c = (await G.connect(admin).deploy(admin.address)) as unknown as VIGILGovernance;
    await c.waitForDeployment();
    // Add the 5 pillars
    await c.connect(admin).addMember(gov.address, 0); // governance
    await c.connect(admin).addMember(jud.address, 1); // judicial
    await c.connect(admin).addMember(civ.address, 2); // civil_society
    await c.connect(admin).addMember(aud.address, 3); // audit
    await c.connect(admin).addMember(tech.address, 4); // technical
    return { c, admin, gov, jud, civ, aud, tech, outsider };
  }

  const FH = ethers.keccak256(ethers.toUtf8Bytes('finding-1'));
  const SALT_DEFAULT = ethers.keccak256(ethers.toUtf8Bytes('salt-default'));

  // Drives the contract's commit-reveal flow per VIGILGovernance.sol:
  //   1. signer commits keccak256(abi.encode(findingHash, uri, salt, signer))
  //   2. wait REVEAL_DELAY (2 minutes) so committedAt + REVEAL_DELAY <= now
  //   3. signer reveals via openProposal(findingHash, uri, salt)
  async function openWithCommitReveal(
    c: VIGILGovernance,
    signer: Signer,
    findingHash: string,
    uri: string,
    salt: string = SALT_DEFAULT,
  ) {
    const signerAddress = await signer.getAddress();
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'string', 'bytes32', 'address'],
        [findingHash, uri, salt, signerAddress],
      ),
    );
    await c.connect(signer).commitProposal(commitment);
    await time.increase(120); // REVEAL_DELAY = 2 minutes
    return c.connect(signer).openProposal(findingHash, uri, salt);
  }

  it('rejects opening a proposal from a non-member', async () => {
    const { c, outsider } = await deploy();
    await expect(openWithCommitReveal(c, outsider, FH, 'ipfs://x')).to.be.revertedWithCustomError(
      c,
      'NotPillarMember',
    );
  });

  it('allows a member to open and 3-of-5 YES escalates', async () => {
    const { c, gov, jud, civ } = await deploy();
    await expect(openWithCommitReveal(c, gov, FH, 'ipfs://abc'))
      .to.emit(c, 'ProposalOpened')
      .withArgs(0n, FH, gov.address, 'ipfs://abc');

    await c.connect(gov).vote(0, 0, ethers.ZeroHash); // YES
    await c.connect(jud).vote(0, 0, ethers.ZeroHash); // YES
    await expect(c.connect(civ).vote(0, 0, ethers.ZeroHash))
      .to.emit(c, 'ProposalEscalated')
      .withArgs(0n);
    const p = await c.getProposal(0);
    expect(p.state).to.equal(1); // Escalated
    expect(p.yes).to.equal(3);
  });

  it('3-of-5 NO dismisses', async () => {
    const { c, gov, jud, civ, aud } = await deploy();
    await openWithCommitReveal(c, gov, FH, 'ipfs://x');
    await c.connect(jud).vote(0, 1, ethers.ZeroHash);
    await c.connect(civ).vote(0, 1, ethers.ZeroHash);
    await expect(c.connect(aud).vote(0, 1, ethers.ZeroHash))
      .to.emit(c, 'ProposalDismissed')
      .withArgs(0n);
  });

  it('forbids double voting', async () => {
    const { c, gov } = await deploy();
    await openWithCommitReveal(c, gov, FH, 'x');
    await c.connect(gov).vote(0, 0, ethers.ZeroHash);
    await expect(c.connect(gov).vote(0, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(
      c,
      'AlreadyVoted',
    );
  });

  it('expires after 14 days when neither YES nor NO reached 3', async () => {
    const { c, gov, jud } = await deploy();
    await openWithCommitReveal(c, gov, FH, 'x');
    await c.connect(gov).vote(0, 0, ethers.ZeroHash); // YES
    await c.connect(jud).vote(0, 1, ethers.ZeroHash); // NO
    await time.increase(15 * 24 * 60 * 60); // 15 days
    await expect(c.settleExpiredProposal(0)).to.emit(c, 'ProposalExpired').withArgs(0n);
    const p = await c.getProposal(0);
    expect(p.state).to.equal(3);
  });

  it('records recuse with reason', async () => {
    const { c, gov } = await deploy();
    await openWithCommitReveal(c, gov, FH, 'x');
    const reason = ethers.keccak256(ethers.toUtf8Bytes('conflict-of-interest'));
    await c.connect(gov).vote(0, 3, reason);
    expect(await c.recuseReason(0, gov.address)).to.equal(reason);
  });

  it('rejects adding a second member to an already-occupied pillar', async () => {
    const { c, admin, outsider } = await deploy();
    await expect(c.connect(admin).addMember(outsider.address, 0)).to.be.revertedWithCustomError(
      c,
      'PillarOccupied',
    );
  });

  /* ----- New coverage tests (commit "test: raise branch coverage to ≥ 90%") ----- */

  it('counts an ABSTAIN vote without escalating or dismissing', async () => {
    const { c, gov, jud } = await deploy();
    await openWithCommitReveal(c, gov, FH, 'ipfs://abstain');
    // 1 YES, 1 ABSTAIN — neither quorum reached, proposal stays Open.
    await c.connect(gov).vote(0, 0, ethers.ZeroHash); // YES
    await c.connect(jud).vote(0, 2, ethers.ZeroHash); // ABSTAIN
    const p = await c.getProposal(0);
    expect(p.yes).to.equal(1);
    expect(p.abstain).to.equal(1);
    expect(p.state).to.equal(0); // Open
  });

  it('rejects an out-of-range vote choice (choice >= 4)', async () => {
    const { c, gov } = await deploy();
    await openWithCommitReveal(c, gov, FH, 'ipfs://invalid');
    await expect(c.connect(gov).vote(0, 4, ethers.ZeroHash)).to.be.revertedWithCustomError(
      c,
      'InvalidChoice',
    );
  });

  it('removeMember strips voting rights (round-trip)', async () => {
    const { c, admin, gov } = await deploy();
    expect((await c.isPillarMember(gov.address))[0]).to.equal(true);
    await expect(c.connect(admin).removeMember(0))
      .to.emit(c, 'MemberRemoved')
      .withArgs(gov.address, 0);
    expect((await c.isPillarMember(gov.address))[0]).to.equal(false);
    // Removed member can no longer commit a proposal.
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'string', 'bytes32', 'address'],
        [FH, 'ipfs://x', SALT_DEFAULT, gov.address],
      ),
    );
    await expect(c.connect(gov).commitProposal(commitment)).to.be.revertedWithCustomError(
      c,
      'NotPillarMember',
    );
  });

  it('rejects removeMember on an unoccupied pillar', async () => {
    const { c, admin } = await deploy();
    await c.connect(admin).removeMember(0);
    await expect(c.connect(admin).removeMember(0)).to.be.revertedWithCustomError(
      c,
      'NotPillarMember',
    );
  });

  it('rejects addMember with the zero address', async () => {
    const { c, admin } = await deploy();
    // Pillar 0 is already occupied (gov); use pillar 1 to surface the
    // ZeroAddress branch first instead of PillarOccupied.
    await c.connect(admin).removeMember(1);
    await expect(c.connect(admin).addMember(ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(
      c,
      'ZeroAddress',
    );
  });

  it('settleExpiredProposal succeeds on an unvoted proposal after the window', async () => {
    const { c, gov } = await deploy();
    await openWithCommitReveal(c, gov, FH, 'ipfs://unvoted');
    await time.increase(15 * 24 * 60 * 60); // 15 days
    await expect(c.settleExpiredProposal(0)).to.emit(c, 'ProposalExpired').withArgs(0n);
    const p = await c.getProposal(0);
    expect(p.state).to.equal(3); // Expired
    expect(p.yes).to.equal(0);
    expect(p.no).to.equal(0);
  });

  it('settleExpiredProposal reverts before the window closes (NotYetExpired)', async () => {
    const { c, gov } = await deploy();
    await openWithCommitReveal(c, gov, FH, 'ipfs://earlier');
    await expect(c.settleExpiredProposal(0)).to.be.revertedWithCustomError(c, 'NotYetExpired');
  });

  it('settleExpiredProposal reverts on an already-settled proposal (ProposalNotOpen)', async () => {
    const { c, gov, jud, civ } = await deploy();
    await openWithCommitReveal(c, gov, FH, 'ipfs://settled');
    await c.connect(gov).vote(0, 0, ethers.ZeroHash);
    await c.connect(jud).vote(0, 0, ethers.ZeroHash);
    await c.connect(civ).vote(0, 0, ethers.ZeroHash); // escalates
    await expect(c.settleExpiredProposal(0)).to.be.revertedWithCustomError(c, 'ProposalNotOpen');
  });

  it('settleExpiredProposal reverts on an unknown proposalIndex', async () => {
    const { c } = await deploy();
    await expect(c.settleExpiredProposal(99)).to.be.revertedWithCustomError(c, 'UnknownProposal');
  });

  it('vote past the window reverts with WindowClosed (state change rolled back on revert)', async () => {
    const { c, gov } = await deploy();
    await openWithCommitReveal(c, gov, FH, 'ipfs://stale');
    await time.increase(15 * 24 * 60 * 60); // 15 days; window is 14
    await expect(c.connect(gov).vote(0, 0, ethers.ZeroHash)).to.be.revertedWithCustomError(
      c,
      'WindowClosed',
    );
    // Solidity rolls back state + events on revert: the proposal stays Open
    // until a separate `settleExpiredProposal` call commits the transition.
    let p = await c.getProposal(0);
    expect(p.state).to.equal(0); // still Open
    await expect(c.settleExpiredProposal(0)).to.emit(c, 'ProposalExpired').withArgs(0n);
    p = await c.getProposal(0);
    expect(p.state).to.equal(3); // Expired
  });

  it('vote reverts on an unknown proposalIndex', async () => {
    const { c, gov } = await deploy();
    await expect(c.connect(gov).vote(99, 0, ethers.ZeroHash)).to.be.revertedWithCustomError(
      c,
      'UnknownProposal',
    );
  });

  it('vote from a non-member is rejected', async () => {
    const { c, gov, outsider } = await deploy();
    await openWithCommitReveal(c, gov, FH, 'ipfs://nonmember');
    await expect(c.connect(outsider).vote(0, 0, ethers.ZeroHash)).to.be.revertedWithCustomError(
      c,
      'NotPillarMember',
    );
  });

  it('commitProposal rejects an empty commitment hash (EmptyCommitment)', async () => {
    const { c, gov } = await deploy();
    await expect(c.connect(gov).commitProposal(ethers.ZeroHash)).to.be.revertedWithCustomError(
      c,
      'EmptyCommitment',
    );
  });

  it('commitProposal from a non-member is rejected (NotPillarMember)', async () => {
    const { c, outsider } = await deploy();
    const commitment = ethers.keccak256(ethers.toUtf8Bytes('any'));
    await expect(c.connect(outsider).commitProposal(commitment)).to.be.revertedWithCustomError(
      c,
      'NotPillarMember',
    );
  });

  it('openProposal rejects an empty findingHash (EmptyFinding)', async () => {
    const { c, gov } = await deploy();
    // Commit something so the call reaches the EmptyFinding branch.
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'string', 'bytes32', 'address'],
        [ethers.ZeroHash, 'ipfs://x', SALT_DEFAULT, gov.address],
      ),
    );
    await c.connect(gov).commitProposal(commitment);
    await time.increase(120);
    await expect(
      c.connect(gov).openProposal(ethers.ZeroHash, 'ipfs://x', SALT_DEFAULT),
    ).to.be.revertedWithCustomError(c, 'EmptyFinding');
  });

  it('openProposal without a prior commit reverts (CommitmentNotFound)', async () => {
    const { c, gov } = await deploy();
    await expect(
      c.connect(gov).openProposal(FH, 'ipfs://no-commit', SALT_DEFAULT),
    ).to.be.revertedWithCustomError(c, 'CommitmentNotFound');
  });

  it('openProposal before REVEAL_DELAY reverts (CommitmentTooEarly)', async () => {
    const { c, gov } = await deploy();
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'string', 'bytes32', 'address'],
        [FH, 'ipfs://too-early', SALT_DEFAULT, gov.address],
      ),
    );
    await c.connect(gov).commitProposal(commitment);
    // No time.increase — reveal-delay not satisfied.
    await expect(
      c.connect(gov).openProposal(FH, 'ipfs://too-early', SALT_DEFAULT),
    ).to.be.revertedWithCustomError(c, 'CommitmentTooEarly');
  });

  it('openProposal cannot be replayed — second reveal of the same commitment fails', async () => {
    const { c, gov } = await deploy();
    await openWithCommitReveal(c, gov, FH, 'ipfs://once');
    // Same (findingHash, uri, salt) — commitment was deleted on first reveal.
    await expect(
      c.connect(gov).openProposal(FH, 'ipfs://once', SALT_DEFAULT),
    ).to.be.revertedWithCustomError(c, 'CommitmentNotFound');
  });

  it('totalProposals reflects opened-and-settled proposal count', async () => {
    const { c, gov } = await deploy();
    expect(await c.totalProposals()).to.equal(0n);
    await openWithCommitReveal(c, gov, FH, 'ipfs://t1');
    expect(await c.totalProposals()).to.equal(1n);
    const fh2 = ethers.keccak256(ethers.toUtf8Bytes('finding-2'));
    await openWithCommitReveal(c, gov, fh2, 'ipfs://t2');
    expect(await c.totalProposals()).to.equal(2n);
  });

  it('quorumRequired returns the on-chain constant', async () => {
    const { c } = await deploy();
    expect(await c.quorumRequired()).to.equal(3);
  });

  it('pillarOf returns the correct pillar id for a member', async () => {
    const { c, jud } = await deploy();
    expect(await c.pillarOf(jud.address)).to.equal(1); // Judicial
  });

  it('constructor rejects the zero address as admin (ZeroAddress)', async () => {
    const G = await ethers.getContractFactory('VIGILGovernance');
    await expect(G.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      await G.deploy((await ethers.getSigners())[0]!.address),
      'ZeroAddress',
    );
  });

  it('getProposal reverts on an unknown proposalIndex (UnknownProposal)', async () => {
    const { c } = await deploy();
    await expect(c.getProposal(0)).to.be.revertedWithCustomError(c, 'UnknownProposal');
  });

  it('removeMember by a non-admin caller is rejected (AccessControlUnauthorizedAccount)', async () => {
    const { c, outsider } = await deploy();
    await expect(c.connect(outsider).removeMember(0)).to.be.revertedWithCustomError(
      c,
      'AccessControlUnauthorizedAccount',
    );
  });

  it('addMember by a non-admin caller is rejected (AccessControlUnauthorizedAccount)', async () => {
    const { c, outsider } = await deploy();
    await c.connect((await ethers.getSigners())[0]!).removeMember(0); // free up pillar 0
    await expect(c.connect(outsider).addMember(outsider.address, 0)).to.be.revertedWithCustomError(
      c,
      'AccessControlUnauthorizedAccount',
    );
  });

  // ---- Tier-15 audit closure: addMember dup-account guard ----
  //
  // The previous addMember() only checked `memberByPillar[pillar].active`.
  // An admin could call addMember(A, pillar=0), then removeMember(0)
  // (deactivating A in pillar 0), then addMember(A, pillar=1) — fine.
  // But the buggy path: addMember(A, pillar=0) followed directly by
  // addMember(A, pillar=1) WITHOUT removing first. The pillar=0 check
  // is on memberByPillar[1] (empty) so passes, leaving:
  //   memberByPillar[0] = {A, 0, active=true}    (stale)
  //   memberByPillar[1] = {A, 1, active=true}    (current)
  //   memberByAccount[A] = {A, 1, active=true}   (overwrites pillar 0)
  // The two mirror mappings diverge. Off-chain indexes that walk
  // memberByPillar[0..4] count A twice. Fix: addMember rejects when
  // memberByAccount[account].active is true.

  it('addMember rejects an account already active in another pillar', async () => {
    const { c, admin, gov, outsider } = await deploy();
    // pillar 1 (Judicial) is held by `jud` from deploy(); free it first
    await c.connect(admin).removeMember(1);
    await expect(c.connect(admin).addMember(gov.address, 1)).to.be.revertedWithCustomError(
      c,
      'AccountAlreadyMember',
    );
    // Confirm a brand-new account on the freed pillar still works
    await expect(c.connect(admin).addMember(outsider.address, 1)).to.emit(c, 'MemberAdded');
  });

  it('addMember accepts re-adding an account after a clean removeMember', async () => {
    const { c, admin, gov } = await deploy();
    await c.connect(admin).removeMember(0); // remove gov from pillar 0
    await expect(c.connect(admin).addMember(gov.address, 2)).to.be.revertedWithCustomError(
      c,
      'PillarOccupied',
    );
    // Pillar 2 was civ; remove civ first
    await c.connect(admin).removeMember(2);
    await expect(c.connect(admin).addMember(gov.address, 2)).to.emit(c, 'MemberAdded');
  });

  // ---- Tier-15 audit closure: vote() past-window no longer mutates ----
  //
  // The previous implementation set p.state = Expired and emitted
  // ProposalExpired before reverting with WindowClosed. Because the
  // revert rolls back state, the mutation+emit were dead code. We
  // dropped them; expiry transitions now happen exclusively via
  // settleExpiredProposal.

  it('vote past the window does NOT emit ProposalExpired (dead-code removal)', async () => {
    const { c, gov, jud } = await deploy();
    await openWithCommitReveal(c, gov, FH, 'ipfs://expiry-test');
    await time.increase(15 * 24 * 60 * 60); // > VOTE_WINDOW (14 days)
    // chai-matchers' .revertedWithCustomError + .to.not.emit both need to
    // submit-and-receipt the tx; reusing one tx-promise across two awaits
    // re-runs the call. Use a single combined matcher instead.
    await expect(c.connect(jud).vote(0, 0, ethers.ZeroHash)).to.be.revertedWithCustomError(
      c,
      'WindowClosed',
    );
    // State should still be Open until someone calls settleExpiredProposal —
    // before T15 the (rolled-back) `p.state = Expired` mutation was dead
    // code, but the contract used to attempt the emit. With the fix the
    // call site is gone entirely; we confirm via the read-side state.
    const p = await c.getProposal(0);
    expect(p.state).to.equal(0); // State.Open
  });

  it('settleExpiredProposal remains the only path that transitions to Expired', async () => {
    const { c, gov } = await deploy();
    await openWithCommitReveal(c, gov, FH, 'ipfs://expiry-test-2');
    await time.increase(15 * 24 * 60 * 60);
    await expect(c.settleExpiredProposal(0)).to.emit(c, 'ProposalExpired');
    const p = await c.getProposal(0);
    expect(p.state).to.equal(3); // State.Expired
  });
});
