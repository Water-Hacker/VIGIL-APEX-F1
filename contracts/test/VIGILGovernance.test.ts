import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { Signer } from 'ethers';

import type { VIGILGovernance } from '../typechain-types';

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
    await expect(
      openWithCommitReveal(c, outsider, FH, 'ipfs://x'),
    ).to.be.revertedWithCustomError(c, 'NotPillarMember');
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
});
