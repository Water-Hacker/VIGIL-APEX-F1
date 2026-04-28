import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('VIGILGovernance', () => {
  async function deploy() {
    const [admin, gov, jud, civ, aud, tech, outsider] = await ethers.getSigners();
    const G = await ethers.getContractFactory('VIGILGovernance');
    const c = await G.connect(admin).deploy(admin.address);
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

  it('rejects opening a proposal from a non-member', async () => {
    const { c, outsider } = await deploy();
    await expect(c.connect(outsider).openProposal(FH, 'ipfs://x')).to.be.revertedWithCustomError(
      c,
      'NotPillarMember',
    );
  });

  it('allows a member to open and 3-of-5 YES escalates', async () => {
    const { c, gov, jud, civ } = await deploy();
    await expect(c.connect(gov).openProposal(FH, 'ipfs://abc'))
      .to.emit(c, 'ProposalOpened')
      .withArgs(0n, FH, gov.address, 'ipfs://abc');

    await c.connect(gov).vote(0, 0, ethers.ZeroHash); // YES
    await c.connect(jud).vote(0, 0, ethers.ZeroHash); // YES
    await expect(c.connect(civ).vote(0, 0, ethers.ZeroHash)).to.emit(c, 'ProposalEscalated').withArgs(0n);
    const p = await c.getProposal(0);
    expect(p.state).to.equal(1); // Escalated
    expect(p.yes).to.equal(3);
  });

  it('3-of-5 NO dismisses', async () => {
    const { c, gov, jud, civ, aud } = await deploy();
    await c.connect(gov).openProposal(FH, 'ipfs://x');
    await c.connect(jud).vote(0, 1, ethers.ZeroHash);
    await c.connect(civ).vote(0, 1, ethers.ZeroHash);
    await expect(c.connect(aud).vote(0, 1, ethers.ZeroHash)).to.emit(c, 'ProposalDismissed').withArgs(0n);
  });

  it('forbids double voting', async () => {
    const { c, gov } = await deploy();
    await c.connect(gov).openProposal(FH, 'x');
    await c.connect(gov).vote(0, 0, ethers.ZeroHash);
    await expect(c.connect(gov).vote(0, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(c, 'AlreadyVoted');
  });

  it('expires after 14 days when neither YES nor NO reached 3', async () => {
    const { c, gov, jud } = await deploy();
    await c.connect(gov).openProposal(FH, 'x');
    await c.connect(gov).vote(0, 0, ethers.ZeroHash); // YES
    await c.connect(jud).vote(0, 1, ethers.ZeroHash); // NO
    await time.increase(15 * 24 * 60 * 60); // 15 days
    await expect(c.settleExpiredProposal(0)).to.emit(c, 'ProposalExpired').withArgs(0n);
    const p = await c.getProposal(0);
    expect(p.state).to.equal(3);
  });

  it('records recuse with reason', async () => {
    const { c, gov } = await deploy();
    await c.connect(gov).openProposal(FH, 'x');
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
