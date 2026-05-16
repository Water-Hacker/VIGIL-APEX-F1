/* eslint-disable unicorn/filename-case -- Hardhat test files mirror the
   contract name (PascalCase) by convention. */
/* global describe, it */
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import type { Signer } from 'ethers';

/**
 * Tests for VIGILGovernanceV1 (upgradeable variant) — FRONTIER-AUDIT
 * federation-upgradability closure.
 *
 * Covers:
 *   - implementation cannot be initialised directly (constructor lock)
 *   - proxy.initialize(admin) succeeds exactly once
 *   - basic V1 governance behaviour (commit-reveal + 3-of-5 escalate)
 *     identical to the non-upgradeable VIGILGovernance
 *   - upgrade to V2 mock preserves V1 state, adds V2 capability
 *   - reinitializer(2) gates V2 initialisation
 */
describe('VIGILGovernanceV1 (upgradeable)', () => {
  const FH = ethers.keccak256(ethers.toUtf8Bytes('finding-1'));
  const SALT = ethers.keccak256(ethers.toUtf8Bytes('salt-1'));

  async function deployBehindProxy() {
    const [admin, gov, jud, civ, aud, tech, outsider] = await ethers.getSigners();
    const Impl = await ethers.getContractFactory('VIGILGovernanceV1');
    const impl = await Impl.deploy();
    await impl.waitForDeployment();

    const initData = impl.interface.encodeFunctionData('initialize', [admin.address]);
    const ProxyFactory = await ethers.getContractFactory('TransparentUpgradeableProxy');
    const proxy = await ProxyFactory.connect(admin).deploy(
      await impl.getAddress(),
      admin.address,
      initData,
    );
    await proxy.waitForDeployment();

    const c = (await ethers.getContractAt(
      'VIGILGovernanceV1',
      await proxy.getAddress(),
    )) as unknown as Awaited<ReturnType<typeof impl.deploymentTransaction>> extends infer _T
      ? import('../typechain-types').VIGILGovernanceV1
      : never;

    // Add the 5 pillars via admin
    await c.connect(admin).addMember(gov.address, 0);
    await c.connect(admin).addMember(jud.address, 1);
    await c.connect(admin).addMember(civ.address, 2);
    await c.connect(admin).addMember(aud.address, 3);
    await c.connect(admin).addMember(tech.address, 4);

    return { c, impl, proxy, admin, gov, jud, civ, aud, tech, outsider };
  }

  async function openWithCommitReveal(
    c: import('../typechain-types').VIGILGovernanceV1,
    signer: Signer,
    findingHash: string,
    uri: string,
    salt: string = SALT,
  ): Promise<bigint> {
    const signerAddress = await signer.getAddress();
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'string', 'bytes32', 'address'],
        [findingHash, uri, salt, signerAddress],
      ),
    );
    await c.connect(signer).commitProposal(commitment);
    await time.increase(120);
    const tx = await c.connect(signer).openProposal(findingHash, uri, salt);
    await tx.wait();
    const idx = (await c.totalProposals()) - 1n;
    return idx;
  }

  it('locks the bare implementation against direct initialisation', async () => {
    const Impl = await ethers.getContractFactory('VIGILGovernanceV1');
    const impl = await Impl.deploy();
    await impl.waitForDeployment();
    const [admin] = await ethers.getSigners();
    await expect(impl.initialize(admin.address)).to.be.revertedWithCustomError(
      impl,
      'InvalidInitialization',
    );
  });

  it('initialises through the proxy and grants admin role', async () => {
    const { c, admin } = await deployBehindProxy();
    const ADMIN_ROLE = await c.ADMIN_ROLE();
    expect(await c.hasRole(ADMIN_ROLE, admin.address)).to.equal(true);
  });

  it('cannot be initialised twice through the proxy', async () => {
    const { c, admin } = await deployBehindProxy();
    await expect(c.initialize(admin.address)).to.be.revertedWithCustomError(
      c,
      'InvalidInitialization',
    );
  });

  it('reaches escalation with 3 YES votes (parity with non-upgradeable)', async () => {
    const { c, gov, jud, civ } = await deployBehindProxy();
    const idx = await openWithCommitReveal(c, gov, FH, 'ipfs://x');
    await c.connect(gov).vote(idx, 0, ethers.ZeroHash);
    await c.connect(jud).vote(idx, 0, ethers.ZeroHash);
    await c.connect(civ).vote(idx, 0, ethers.ZeroHash);
    const p = await c.getProposal(idx);
    expect(p.state).to.equal(1); // Escalated
  });

  it('rejects non-members from voting', async () => {
    const { c, gov, outsider } = await deployBehindProxy();
    const idx = await openWithCommitReveal(c, gov, FH, 'ipfs://y');
    await expect(c.connect(outsider).vote(idx, 0, ethers.ZeroHash)).to.be.revertedWithCustomError(
      c,
      'NotPillarMember',
    );
  });

  it('reports contractVersion = "v1"', async () => {
    const { c } = await deployBehindProxy();
    expect(await c.contractVersion()).to.equal('v1');
  });

  // ---- Tier-15 audit closure mirrors ----

  it('addMember rejects an account already active in another pillar (V1 mirror)', async () => {
    const { c, admin, gov, outsider } = await deployBehindProxy();
    await c.connect(admin).removeMember(1);
    await expect(c.connect(admin).addMember(gov.address, 1)).to.be.revertedWithCustomError(
      c,
      'AccountAlreadyMember',
    );
    await expect(c.connect(admin).addMember(outsider.address, 1)).to.emit(c, 'MemberAdded');
  });

  it('vote past the window does NOT emit ProposalExpired (V1 mirror)', async () => {
    const { c, gov, jud } = await deployBehindProxy();
    const idx = await openWithCommitReveal(c, gov, FH, 'ipfs://expiry');
    await time.increase(15 * 24 * 60 * 60);
    await expect(c.connect(jud).vote(idx, 0, ethers.ZeroHash)).to.be.revertedWithCustomError(
      c,
      'WindowClosed',
    );
    const p = await c.getProposal(idx);
    expect(p.state).to.equal(0); // State.Open — settleExpiredProposal is the only transition path
  });
});

describe('VIGILGovernanceV1 → V2 upgrade path', () => {
  async function deployBehindProxy() {
    const [admin, gov] = await ethers.getSigners();
    const Impl = await ethers.getContractFactory('VIGILGovernanceV1');
    const impl = await Impl.deploy();
    await impl.waitForDeployment();
    const initData = impl.interface.encodeFunctionData('initialize', [admin.address]);
    const ProxyFactory = await ethers.getContractFactory('TransparentUpgradeableProxy');
    const proxy = await ProxyFactory.connect(admin).deploy(
      await impl.getAddress(),
      admin.address,
      initData,
    );
    await proxy.waitForDeployment();
    const c = await ethers.getContractAt('VIGILGovernanceV1', await proxy.getAddress());
    await c.connect(admin).addMember(gov.address, 0);
    return { c, impl, proxy, admin, gov };
  }

  it('admin can upgrade the proxy to V2 and preserve V1 state', async () => {
    const { c, proxy, admin, gov } = await deployBehindProxy();
    expect(await c.contractVersion()).to.equal('v1');

    const V2 = await ethers.getContractFactory('VIGILGovernanceV2Mock');
    const v2impl = await V2.deploy();
    await v2impl.waitForDeployment();

    // Locate the ProxyAdmin auto-created by TransparentUpgradeableProxy.
    // It is exposed via the ERC-1967 admin slot of the proxy.
    const adminSlot = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
    const rawAdmin = await ethers.provider.getStorage(await proxy.getAddress(), adminSlot);
    const proxyAdminAddr = ethers.getAddress('0x' + rawAdmin.slice(-40));
    const proxyAdmin = await ethers.getContractAt('ProxyAdmin', proxyAdminAddr);

    const reinitData = V2.interface.encodeFunctionData('initializeV2', [1]);
    await proxyAdmin
      .connect(admin)
      .upgradeAndCall(await proxy.getAddress(), await v2impl.getAddress(), reinitData);

    const v2 = await ethers.getContractAt('VIGILGovernanceV2Mock', await proxy.getAddress());
    expect(await v2.contractVersion()).to.equal('v2-mock');
    // V1 state preserved
    const [active, pillar] = await v2.isPillarMember(gov.address);
    expect(active).to.equal(true);
    expect(pillar).to.equal(0);
    // V2 capability available
    expect(await v2.delegationFactor(0)).to.equal(1);
  });

  it('reinitializer(2) blocks a second V2 initialisation', async () => {
    const { proxy, admin } = await deployBehindProxy();
    const V2 = await ethers.getContractFactory('VIGILGovernanceV2Mock');
    const v2impl = await V2.deploy();
    await v2impl.waitForDeployment();

    const adminSlot = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
    const rawAdmin = await ethers.provider.getStorage(await proxy.getAddress(), adminSlot);
    const proxyAdminAddr = ethers.getAddress('0x' + rawAdmin.slice(-40));
    const proxyAdmin = await ethers.getContractAt('ProxyAdmin', proxyAdminAddr);

    const reinitData = V2.interface.encodeFunctionData('initializeV2', [1]);
    await proxyAdmin
      .connect(admin)
      .upgradeAndCall(await proxy.getAddress(), await v2impl.getAddress(), reinitData);

    const v2 = await ethers.getContractAt('VIGILGovernanceV2Mock', await proxy.getAddress());
    await expect(v2.initializeV2(2)).to.be.revertedWithCustomError(v2, 'InvalidInitialization');
  });
});
