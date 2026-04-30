/* eslint-disable unicorn/filename-case -- Hardhat test files mirror the
   contract name (PascalCase) by convention; renaming breaks the
   convention without functional benefit. */
/* global describe, it */
import { expect } from 'chai';
import { ethers } from 'hardhat';

import type { VIGILAnchor } from '../typechain-types';

describe('VIGILAnchor', () => {
  async function deploy() {
    const [owner, committer, attacker] = await ethers.getSigners();
    const Anchor = await ethers.getContractFactory('VIGILAnchor');
    const anchor = (await Anchor.connect(owner).deploy(
      committer.address,
    )) as unknown as VIGILAnchor;
    await anchor.waitForDeployment();
    return { anchor, owner, committer, attacker };
  }

  it('rejects commit from non-committer', async () => {
    const { anchor, attacker } = await deploy();
    await expect(
      anchor.connect(attacker).commit(1, 100, ethers.keccak256(ethers.toUtf8Bytes('root1'))),
    ).to.be.revertedWithCustomError(anchor, 'NotCommitter');
  });

  it('accepts a valid commit', async () => {
    const { anchor, committer } = await deploy();
    const root = ethers.keccak256(ethers.toUtf8Bytes('root1'));
    await expect(anchor.connect(committer).commit(1, 100, root))
      .to.emit(anchor, 'Anchored')
      .withArgs(0, 1, 100, root, committer.address);
    expect(await anchor.totalCommitments()).to.equal(1);
    const c = await anchor.getCommitment(0);
    expect(c.fromSeq).to.equal(1n);
    expect(c.toSeq).to.equal(100n);
    expect(c.rootHash).to.equal(root);
  });

  it('rejects empty roothash', async () => {
    const { anchor, committer } = await deploy();
    await expect(
      anchor.connect(committer).commit(1, 1, ethers.ZeroHash),
    ).to.be.revertedWithCustomError(anchor, 'EmptyRoot');
  });

  it('rejects non-contiguous range', async () => {
    const { anchor, committer } = await deploy();
    const a = ethers.keccak256(ethers.toUtf8Bytes('a'));
    const b = ethers.keccak256(ethers.toUtf8Bytes('b'));
    await anchor.connect(committer).commit(1, 100, a);
    // Next must start at 101
    await expect(anchor.connect(committer).commit(50, 60, b)).to.be.revertedWithCustomError(
      anchor,
      'NonContiguous',
    );
    await expect(anchor.connect(committer).commit(101, 100, b)).to.be.revertedWithCustomError(
      anchor,
      'InvalidRange',
    );
    // Valid
    await expect(anchor.connect(committer).commit(101, 200, b)).to.emit(anchor, 'Anchored');
  });

  it('rotates committer (owner only)', async () => {
    const { anchor, owner, committer, attacker } = await deploy();
    await expect(
      anchor.connect(attacker).rotateCommitter(attacker.address),
    ).to.be.revertedWithCustomError(anchor, 'OwnableUnauthorizedAccount');
    await expect(anchor.connect(owner).rotateCommitter(attacker.address))
      .to.emit(anchor, 'CommitterRotated')
      .withArgs(committer.address, attacker.address);
    expect(await anchor.committer()).to.equal(attacker.address);
  });

  it('rejects out-of-range commitment lookup', async () => {
    const { anchor } = await deploy();
    await expect(anchor.getCommitment(0)).to.be.revertedWithCustomError(
      anchor,
      'CommitmentNotFound',
    );
  });
});
