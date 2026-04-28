/**
 * Wire type for an audit-witness commitment, mirrored on both sides:
 *   - chaincode `audit-witness` writes/reads it
 *   - worker-fabric-bridge serialises Postgres rows into it
 *   - audit-verifier --cross-witness compares both sides
 *
 * Keep this type in sync with chaincode/audit-witness/src/contract.ts:Commitment.
 */
export interface FabricCommitment {
  readonly seq: string;        // bigint serialised as string
  readonly bodyHash: string;   // 64-char lowercase hex
  readonly recordedAt: string; // RFC3339 from chaincode txTimestamp
}

export interface FabricBridgeOptions {
  readonly mspId: string;
  readonly peerEndpoint: string;          // e.g. vigil-fabric-peer0-org1:7051
  readonly peerHostAlias?: string;        // SAN override when not resolvable
  readonly channelName: string;           // 'vigil-audit'
  readonly chaincodeName: string;         // 'audit-witness'
  /**
   * Filesystem paths to MSP material. Materialised by
   * 05-secret-materialisation.sh from Vault into /run/vigil/secrets/.
   */
  readonly tlsRootCertPath: string;
  readonly clientCertPath: string;
  readonly clientPrivateKeyPath: string;
}

export type SubmitOutcome =
  | { kind: 'recorded'; txId: string; blockHeight?: number }
  | { kind: 'duplicate'; txId: string }
  | { kind: 'divergence'; existingBodyHash: string; newBodyHash: string };
