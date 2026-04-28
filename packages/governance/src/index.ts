/**
 * @vigil/governance — contract clients + quorum logic.
 *
 * SRD §22-§23. Polygon-mainnet contracts:
 *   - VIGILAnchor.sol — append-only hash registry
 *   - VIGILGovernance.sol — 5-pillar 3-of-5 escalation, 4-of-5 public release
 */
export * from './abi.js';
export * from './governance-client.js';
export * from './quorum.js';
