import '@nomicfoundation/hardhat-toolbox';
import 'hardhat-gas-reporter';

import type { HardhatUserConfig } from 'hardhat/config';

/**
 * Hardhat configuration — VIGIL APEX contracts.
 *
 * Networks:
 *   - hardhat (in-memory) — unit tests
 *   - mumbai / amoy       — Polygon testnets (Mumbai is sunsetting; Amoy is the successor)
 *   - polygon             — Polygon mainnet, deployed at Phase 7 (SRD §22.8 ceremony)
 *
 * Private keys are NEVER inlined here. Hardhat uses the keystore JSON pulled
 * from Vault during deploy-time, OR a YubiKey signer in production. The
 * empty `accounts` lists below force explicit per-deploy provisioning.
 */

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.27',
    settings: {
      optimizer: { enabled: true, runs: 1_000 },
      viaIR: true,
      evmVersion: 'paris',
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      mining: { auto: true },
      hardfork: 'cancun',
    },
    amoy: {
      url: process.env.POLYGON_AMOY_RPC ?? 'https://rpc-amoy.polygon.technology',
      chainId: 80_002,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com',
      chainId: 137,
      // Production deploy uses the YubiKey-backed signer; never plain key here.
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      gasPrice: 'auto',
    },
  },
  etherscan: {
    apiKey: {
      polygon: process.env.POLYGONSCAN_API_KEY ?? '',
      polygonAmoy: process.env.POLYGONSCAN_API_KEY ?? '',
    },
    customChains: [
      {
        network: 'polygonAmoy',
        chainId: 80_002,
        urls: {
          apiURL: 'https://api-amoy.polygonscan.com/api',
          browserURL: 'https://amoy.polygonscan.com',
        },
      },
    ],
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    currency: 'USD',
    excludeContracts: [],
  },
  mocha: { timeout: 60_000 },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
};

export default config;
