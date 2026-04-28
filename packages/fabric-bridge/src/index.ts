/**
 * @vigil/fabric-bridge — narrow wrapper around the Hyperledger Fabric
 * gateway SDK. Only used by:
 *   - apps/worker-fabric-bridge — Postgres → Fabric replication
 *   - apps/audit-verifier --cross-witness — divergence detection
 *
 * The package's surface stays deliberately small; expanding it requires
 * an architect decision logged in `docs/decisions/log.md`.
 */
export * from './client.js';
export * from './types.js';
