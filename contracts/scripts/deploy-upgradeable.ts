import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { ethers, network, run } from 'hardhat';

/**
 * Deploy script — VIGILGovernanceV1 behind a TransparentUpgradeableProxy.
 *
 * Use this script ONLY when deploying the federation-upgradeable variant
 * (FRONTIER-AUDIT federation-upgradability closure). The non-upgradeable
 * single-council deployment continues to use scripts/deploy.ts.
 *
 * Flow:
 *   1. Deploy VIGILGovernanceV1 implementation contract.
 *   2. Deploy TransparentUpgradeableProxy pointing at the implementation,
 *      with the proxy admin = GOVERNANCE_PROXY_OWNER (a multisig or
 *      hardware-key custodian; never an EOA in production).
 *   3. Call initialize(admin) via the proxy.
 *   4. Persist deployment metadata including the auto-created ProxyAdmin
 *      address; the architect MUST record this address out-of-band and
 *      rotate it to a multisig before announcing the deployment.
 *
 * Upgrades after deployment go through ProxyAdmin.upgradeAndCall(...) and
 * MUST be witnessed by the 5-pillar council per SRD §22.8.
 */
async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address} — balance ${ethers.formatEther(balance)} MATIC`);

  const adminAddr = process.env.GOVERNANCE_ADMIN_ADDRESS ?? deployer.address;
  const proxyOwnerAddr = process.env.GOVERNANCE_PROXY_OWNER ?? deployer.address;

  // 1. Deploy implementation
  const Impl = await ethers.getContractFactory('VIGILGovernanceV1');
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log(`VIGILGovernanceV1 implementation deployed at ${implAddr}`);

  // 2. Deploy proxy with initial init data
  const initData = impl.interface.encodeFunctionData('initialize', [adminAddr]);
  const ProxyFactory = await ethers.getContractFactory('TransparentUpgradeableProxy');
  const proxy = await ProxyFactory.deploy(implAddr, proxyOwnerAddr, initData);
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  console.log(`TransparentUpgradeableProxy deployed at ${proxyAddr}`);

  // 3. Resolve the auto-created ProxyAdmin via ERC-1967 admin slot
  const adminSlot = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
  const rawAdmin = await ethers.provider.getStorage(proxyAddr, adminSlot);
  const proxyAdminAddr = ethers.getAddress('0x' + rawAdmin.slice(-40));
  console.log(`ProxyAdmin (auto-created) at ${proxyAdminAddr}`);
  console.log(`ProxyAdmin owner = ${proxyOwnerAddr} — rotate to multisig before announcing!`);

  // 4. Save deployment metadata
  const meta = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      VIGILGovernanceV1: {
        implementation: implAddr,
        proxy: proxyAddr,
        proxyAdmin: proxyAdminAddr,
        proxyOwner: proxyOwnerAddr,
        admin: adminAddr,
      },
    },
  };
  const outDir = path.join(__dirname, '..', 'deployments');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:fs').mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, `${network.name}-upgradeable.json`),
    JSON.stringify(meta, null, 2),
  );
  console.log(`Metadata written to deployments/${network.name}-upgradeable.json`);

  if (
    network.name !== 'hardhat' &&
    network.name !== 'localhost' &&
    process.env.POLYGONSCAN_API_KEY
  ) {
    console.log('Verifying contracts on block explorer...');
    try {
      await run('verify:verify', { address: implAddr, constructorArguments: [] });
      await run('verify:verify', {
        address: proxyAddr,
        constructorArguments: [implAddr, proxyOwnerAddr, initData],
      });
    } catch (e) {
      console.warn('Verification failed (non-fatal):', e);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
