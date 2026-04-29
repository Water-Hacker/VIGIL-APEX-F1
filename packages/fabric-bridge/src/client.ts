import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as grpc from '@grpc/grpc-js';
import { connect, signers, type Gateway, type Network, type Contract } from '@hyperledger/fabric-gateway';
import { createLogger, type Logger } from '@vigil/observability';

import type { FabricBridgeOptions, FabricCommitment, SubmitOutcome } from './types.js';

/**
 * FabricBridge — wraps the @hyperledger/fabric-gateway client. One
 * instance per process; the gateway, gRPC channel, and signer are
 * connection-pooled internally by the SDK.
 *
 * The class is intentionally narrow: only the operations
 * worker-fabric-bridge and the cross-witness verifier need. Adding
 * surface area is a deliberate decision (every chaincode call is
 * potentially audit-relevant).
 */
export class FabricBridge {
  private readonly logger: Logger;
  private gateway: Gateway | null = null;
  private network: Network | null = null;
  private contract: Contract | null = null;

  constructor(
    private readonly opts: FabricBridgeOptions,
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger({ service: 'fabric-bridge' });
  }

  async connect(): Promise<void> {
    if (this.gateway) return;
    const tlsRoot = readFileSync(this.opts.tlsRootCertPath);
    const credentials = grpc.credentials.createSsl(tlsRoot);
    const grpcClient = new grpc.Client(
      this.opts.peerEndpoint,
      credentials,
      this.opts.peerHostAlias
        ? { 'grpc.ssl_target_name_override': this.opts.peerHostAlias }
        : {},
    );

    const cert = readFileSync(this.opts.clientCertPath);
    const key = crypto.createPrivateKey(readFileSync(this.opts.clientPrivateKeyPath));
    const identity = { mspId: this.opts.mspId, credentials: cert };
    const signer = signers.newPrivateKeySigner(key);

    this.gateway = connect({
      client: grpcClient,
      identity,
      signer,
      // Per-call deadlines (Phase G acceptance: < 5 s commitment).
      evaluateOptions: () => ({ deadline: Date.now() + 5_000 }),
      endorseOptions: () => ({ deadline: Date.now() + 15_000 }),
      submitOptions: () => ({ deadline: Date.now() + 5_000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 60_000 }),
    });
    this.network = this.gateway.getNetwork(this.opts.channelName);
    this.contract = this.network.getContract(this.opts.chaincodeName);
    this.logger.info(
      { peer: this.opts.peerEndpoint, channel: this.opts.channelName },
      'fabric-bridge-connected',
    );
  }

  async close(): Promise<void> {
    if (this.gateway) {
      this.gateway.close();
      this.gateway = null;
      this.network = null;
      this.contract = null;
    }
  }

  /**
   * Submit a commitment to the audit-witness chaincode. The chaincode
   * is idempotent on (seq, bodyHash) and throws on (seq, *different
   * bodyHash*) — we map that into a typed outcome here so the caller
   * (worker-fabric-bridge) can drive the divergence alert path.
   */
  async submitCommitment(seq: string | bigint, bodyHash: string): Promise<SubmitOutcome> {
    if (!this.contract) await this.connect();
    const seqStr = typeof seq === 'bigint' ? seq.toString() : seq;
    const lower = bodyHash.toLowerCase();
    try {
      const result = await this.contract!.submit('RecordCommitment', {
        arguments: [seqStr, lower],
      });
      void result;
      // Gateway SDK returns the value bytes; we don't use the return
      // value here because the chaincode returns void on success.
      return { kind: 'recorded', txId: 'see-events' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const m = msg.match(/divergence at seq=(\d+): existing=([0-9a-f]{64}) new=([0-9a-f]{64})/);
      if (m) {
        return {
          kind: 'divergence',
          existingBodyHash: m[2]!,
          newBodyHash: m[3]!,
        };
      }
      throw err;
    }
  }

  async queryCommitment(seq: string | bigint): Promise<FabricCommitment | null> {
    if (!this.contract) await this.connect();
    const seqStr = typeof seq === 'bigint' ? seq.toString() : seq;
    const raw = await this.contract!.evaluate('GetCommitment', { arguments: [seqStr] });
    const text = Buffer.from(raw).toString('utf8');
    if (!text || text === 'null') return null;
    return JSON.parse(text) as FabricCommitment;
  }

  /**
   * Range read for the cross-witness verifier. Returns commitments in
   * ascending seq order. The chaincode handles the lexicographic
   * → numeric ordering via zero-padded keys.
   */
  async listCommitments(from: string | bigint, to: string | bigint): Promise<FabricCommitment[]> {
    if (!this.contract) await this.connect();
    const a = typeof from === 'bigint' ? from.toString() : from;
    const b = typeof to === 'bigint' ? to.toString() : to;
    const raw = await this.contract!.evaluate('ListCommitments', { arguments: [a, b] });
    const text = Buffer.from(raw).toString('utf8');
    return JSON.parse(text) as FabricCommitment[];
  }
}
