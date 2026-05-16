/* eslint-disable unicorn/filename-case -- Hardhat test convention */
/* global describe, it */

/**
 * Tier-51 audit closure — on-chain input bounds.
 *
 * Two defences:
 *
 *   (A) VIGILAnchor MAX_RANGE_PER_COMMIT
 *       Pre-fix, commit() accepted any (fromSeq, toSeq) with fromSeq <= toSeq.
 *       A typo or compromised committer submitting `toSeq = 1e30` would
 *       set lastToSeq to that value; every subsequent commit must satisfy
 *       fromSeq == lastToSeq + 1, so the anchor was permanently locked
 *       out of accepting the legitimate audit chain (which starts at
 *       seq=1 and advances by ~1k-10k per cycle). Cap at 1_000_000.
 *
 *   (B) VIGILGovernance MAX_URI_BYTES
 *       Pre-fix, openProposal() accepted any-size string `uri`. A pillar
 *       member could push a multi-MB URI into ProposalOpened event logs
 *       + storage — calldata costs ~16 gas/byte, so up to ~1.8 MB fits
 *       in a single Polygon block. Cheap griefing surface; bloats every
 *       indexer + dashboard reader. Cap at 2048 chars (comfortably above
 *       ipfs://CID).
 */

import { expect } from 'chai';
import { ethers } from 'hardhat';

import type { VIGILAnchor, VIGILGovernance } from '../typechain-types';

describe('Tier-51 — VIGILAnchor MAX_RANGE_PER_COMMIT', () => {
  async function deploy() {
    const [owner, committer, attacker] = await ethers.getSigners();
    const Anchor = await ethers.getContractFactory('VIGILAnchor');
    const anchor = (await Anchor.connect(owner).deploy(
      committer.address,
    )) as unknown as VIGILAnchor;
    await anchor.waitForDeployment();
    return { anchor, owner, committer, attacker };
  }

  it('exposes MAX_RANGE_PER_COMMIT as a 1_000_000 constant', async () => {
    const { anchor } = await deploy();
    expect(await anchor.MAX_RANGE_PER_COMMIT()).to.equal(1_000_000n);
  });

  it('rejects a commit whose span exceeds 1_000_000 with RangeTooLarge', async () => {
    const { anchor, committer } = await deploy();
    const root = ethers.keccak256(ethers.toUtf8Bytes('big'));
    // span = 1_000_001 (from=1, to=1_000_001 → 1_000_001 - 1 + 1 = 1_000_001)
    await expect(
      anchor.connect(committer).commit(1, 1_000_001, root),
    ).to.be.revertedWithCustomError(anchor, 'RangeTooLarge');
  });

  it('rejects the operator-typo case (toSeq = 1e18) without bricking the anchor', async () => {
    const { anchor, committer } = await deploy();
    const root = ethers.keccak256(ethers.toUtf8Bytes('typo'));
    await expect(
      anchor.connect(committer).commit(1, 10n ** 18n, root),
    ).to.be.revertedWithCustomError(anchor, 'RangeTooLarge');
    // lastToSeq was NOT advanced; a legitimate commit still works.
    await expect(anchor.connect(committer).commit(1, 100, root)).to.emit(anchor, 'Anchored');
  });

  it('accepts a span of exactly 1_000_000 (no off-by-one at the boundary)', async () => {
    const { anchor, committer } = await deploy();
    const root = ethers.keccak256(ethers.toUtf8Bytes('exact'));
    // span = 1_000_000 (from=1, to=1_000_000)
    await expect(anchor.connect(committer).commit(1, 1_000_000, root)).to.emit(anchor, 'Anchored');
  });

  it('accepts a single-seq commit (no regression on the smallest valid span)', async () => {
    const { anchor, committer } = await deploy();
    const root = ethers.keccak256(ethers.toUtf8Bytes('single'));
    await expect(anchor.connect(committer).commit(1, 1, root)).to.emit(anchor, 'Anchored');
  });
});

describe('Tier-51 — VIGILGovernance MAX_URI_BYTES', () => {
  async function deploy() {
    const [admin, pillarMember] = await ethers.getSigners();
    const Gov = await ethers.getContractFactory('VIGILGovernance');
    const gov = (await Gov.connect(admin).deploy(admin.address)) as unknown as VIGILGovernance;
    await gov.waitForDeployment();
    // Seat the pillar member so openProposal() can be exercised.
    await gov.connect(admin).addMember(pillarMember.address, 0); // Governance pillar
    return { gov, admin, pillarMember };
  }

  async function commitAndAdvance(
    gov: VIGILGovernance,
    pillarMember: Awaited<ReturnType<typeof ethers.getSigners>>[number],
    findingHash: string,
    uri: string,
    salt: string,
  ): Promise<void> {
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'string', 'bytes32', 'address'],
        [findingHash, uri, salt, pillarMember.address],
      ),
    );
    await gov.connect(pillarMember).commitProposal(commitment);
    // Advance past REVEAL_DELAY (2 minutes).
    await ethers.provider.send('evm_increaseTime', [121]);
    await ethers.provider.send('evm_mine', []);
  }

  it('exposes MAX_URI_BYTES as a 2048 constant', async () => {
    const { gov } = await deploy();
    expect(await gov.MAX_URI_BYTES()).to.equal(2048n);
  });

  it('rejects openProposal with uri > 2048 bytes via UriTooLarge', async () => {
    const { gov, pillarMember } = await deploy();
    const fh = ethers.keccak256(ethers.toUtf8Bytes('finding-1'));
    const salt = ethers.keccak256(ethers.toUtf8Bytes('salt-1'));
    const bigUri = 'ipfs://' + 'a'.repeat(2042); // total length = 2049
    await commitAndAdvance(gov, pillarMember, fh, bigUri, salt);
    await expect(
      gov.connect(pillarMember).openProposal(fh, bigUri, salt),
    ).to.be.revertedWithCustomError(gov, 'UriTooLarge');
  });

  it('accepts openProposal with uri exactly 2048 bytes (boundary)', async () => {
    const { gov, pillarMember } = await deploy();
    const fh = ethers.keccak256(ethers.toUtf8Bytes('finding-2'));
    const salt = ethers.keccak256(ethers.toUtf8Bytes('salt-2'));
    const exactUri = 'a'.repeat(2048);
    await commitAndAdvance(gov, pillarMember, fh, exactUri, salt);
    await expect(gov.connect(pillarMember).openProposal(fh, exactUri, salt)).to.emit(
      gov,
      'ProposalOpened',
    );
  });

  it('accepts a normal ipfs URI (no regression)', async () => {
    const { gov, pillarMember } = await deploy();
    const fh = ethers.keccak256(ethers.toUtf8Bytes('finding-3'));
    const salt = ethers.keccak256(ethers.toUtf8Bytes('salt-3'));
    const normalUri = 'ipfs://bafkreibme22gw2h7y2h7tg2fhqotaqjucnbc24deqo72b6mkl2egezxhvy';
    await commitAndAdvance(gov, pillarMember, fh, normalUri, salt);
    await expect(gov.connect(pillarMember).openProposal(fh, normalUri, salt)).to.emit(
      gov,
      'ProposalOpened',
    );
  });
});
