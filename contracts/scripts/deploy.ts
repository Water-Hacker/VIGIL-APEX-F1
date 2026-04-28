import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { ethers, network, run } from 'hardhat';

/**
 * Deploy script — VIGILAnchor + VIGILGovernance.
 *
 * Per SRD §22.8 (deployment ceremony): on Polygon mainnet, the deployer
 * wallet is the YubiKey-backed signer; this script picks up the configured
 * Hardhat account and writes deployment metadata to `deployments/<network>.json`.
 */
async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address} — balance ${ethers.formatEther(balance)} MATIC`);

  // 1. VIGILAnchor — committer = deployer initially; rotated post-deploy to host signer.
  const Anchor = await ethers.getContractFactory('VIGILAnchor');
  const anchor = await Anchor.deploy(deployer.address);
  await anchor.waitForDeployment();
  const anchorAddr = await anchor.getAddress();
  console.log(`VIGILAnchor deployed at ${anchorAddr}`);

  // 2. VIGILGovernance — admin = multisig owner address (pulled from env)
  const adminAddr = process.env.GOVERNANCE_ADMIN_ADDRESS ?? deployer.address;
  const Governance = await ethers.getContractFactory('VIGILGovernance');
  const gov = await Governance.deploy(adminAddr);
  await gov.waitForDeployment();
  const govAddr = await gov.getAddress();
  console.log(`VIGILGovernance deployed at ${govAddr} (admin=${adminAddr})`);

  // 3. Save deployment metadata
  const meta = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      VIGILAnchor: { address: anchorAddr, committer: deployer.address },
      VIGILGovernance: { address: govAddr, admin: adminAddr },
    },
  };
  const outDir = path.join(__dirname, '..', 'deployments');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:fs').mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `${network.name}.json`), JSON.stringify(meta, null, 2));
  console.log(`Deployment metadata written to deployments/${network.name}.json`);

  // 4. Verify on PolygonScan when not on a local network
  if (network.name !== 'hardhat' && network.name !== 'localhost' && process.env.POLYGONSCAN_API_KEY) {
    console.log('Verifying contracts on block explorer...');
    try {
      await run('verify:verify', { address: anchorAddr, constructorArguments: [deployer.address] });
      await run('verify:verify', { address: govAddr, constructorArguments: [adminAddr] });
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
