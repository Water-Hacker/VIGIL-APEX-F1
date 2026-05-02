/**
 * @vigil/audit-chain — Postgres hash chain + Polygon anchor.
 *
 * Per W-11 fix: MVP uses a Postgres `audit.actions` hash chain in place of
 * Hyperledger Fabric. Each row carries `prev_hash` and `body_hash` (SHA-256).
 * The chain is verified hourly (CT-01); the latest root is anchored to Polygon
 * mainnet hourly (CT-02) via VIGILAnchor.sol.
 *
 * Public API:
 *   - HashChain.append(...) → insert with computed hashes
 *   - HashChain.verify(...) → sweep range; throw on break
 *   - PolygonAnchor.commit(rootHash) → submit on-chain
 *   - LedgerVerifier.verifyAgainstChain() → on-chain root matches local
 */
export * from './hash-chain.js';
export * from './polygon-anchor.js';
export * from './verifier.js';
export * from './canonical.js';
export * from './offline-verify.js';
