import { resolve as resolvePath } from 'node:path';
import { readFileSync } from 'node:fs';

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { createLogger, type Logger } from '@vigil/observability';

import { signEnvelope } from './sign.js';
import type {
  EventEnvelope,
  EventEnvelopeUnsigned,
  HealthBeaconReply,
  PushAck,
  RegionCode,
} from './types.js';

const PROTO_PATH = resolvePath(__dirname, '..', 'proto', 'federation.proto');

interface FederationGrpcDef {
  vigil: {
    federation: {
      v1: {
        FederationStream: grpc.ServiceClientConstructor;
      };
    };
  };
}

let cachedClientCtor: grpc.ServiceClientConstructor | null = null;

function loadServiceCtor(): grpc.ServiceClientConstructor {
  if (cachedClientCtor) return cachedClientCtor;
  const def = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(def) as unknown as FederationGrpcDef;
  cachedClientCtor = pkg.vigil.federation.v1.FederationStream;
  return cachedClientCtor;
}

export interface FederationClientOptions {
  /** Core endpoint (host:port) — typically the WireGuard-reachable Yaoundé core. */
  readonly coreEndpoint: string;
  /** TLS root for the core's cert (Vault root CA). */
  readonly tlsRootCertPath: string;
  /** Region this client is signing for (drives signing_key_id prefix). */
  readonly region: RegionCode;
  /** Vault PKI key id, e.g. "CE:42" (region:rotation-seq). */
  readonly signingKeyId: string;
  /**
   * The ed25519 private key (PEM) used to sign every outgoing
   * envelope. Materialised by infra/host-bootstrap/05-secret-
   * materialisation.sh from Vault's regional `pki-region-<code>/`
   * mount into /run/vigil/secrets/federation-signer.key.
   */
  readonly signingPrivateKeyPath: string;
  /** Per-batch flush boundary (envelopes). Defaults to 256. */
  readonly batchSize?: number;
  /** Per-batch flush boundary (ms). Defaults to 2 000. */
  readonly batchIntervalMs?: number;
  /** Logger; defaults to a `federation-stream-client` instance. */
  readonly logger?: Logger;
}

/**
 * FederationStreamClient — used by the regional federation-agent.
 *
 * Lifecycle:
 *   - new FederationStreamClient(opts) — constructs but does NOT
 *     open the stream (gRPC channels are lazy).
 *   - client.start() — opens the long-lived PushEvents stream and
 *     starts the batch timer.
 *   - client.push(unsigned) — signs and enqueues. Returns a Promise
 *     that resolves to the per-batch PushAck containing this
 *     envelope's id (so the caller can drive at-least-once delivery
 *     against the local SQLite WAL).
 *   - client.beacon(req) — unary HealthBeacon RPC.
 *   - client.close() — drains the queue, sends a final ack-pending
 *     batch, and closes the stream.
 *
 * The client is intentionally single-stream — one process, one
 * stream, one signing key. Opening multiple streams in parallel
 * would require per-stream key isolation that we don't need.
 */
export class FederationStreamClient {
  private readonly logger: Logger;
  private readonly batchSize: number;
  private readonly batchIntervalMs: number;
  private readonly privateKeyPem: string;

  private grpcClient: grpc.Client | null = null;
  private stream: grpc.ClientWritableStream<unknown> | null = null;
  private pendingBatch: EventEnvelope[] = [];
  private pendingResolvers = new Map<string, (ack: PushAck) => void>();
  private flushTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly opts: FederationClientOptions) {
    this.logger = opts.logger ?? createLogger({ service: 'federation-stream-client', region: opts.region });
    this.batchSize = opts.batchSize ?? 256;
    this.batchIntervalMs = opts.batchIntervalMs ?? 2_000;
    this.privateKeyPem = readFileSync(opts.signingPrivateKeyPath, 'utf8');
  }

  start(): void {
    if (this.grpcClient) return;
    const Ctor = loadServiceCtor();
    const tlsRoot = readFileSync(this.opts.tlsRootCertPath);
    const credentials = grpc.credentials.createSsl(tlsRoot);
    this.grpcClient = new Ctor(this.opts.coreEndpoint, credentials, {
      // 30 s keepalive matches the HealthBeacon cadence.
      'grpc.keepalive_time_ms': 30_000,
      'grpc.keepalive_timeout_ms': 10_000,
      'grpc.keepalive_permit_without_calls': 1,
      // Cap message size at MAX_PAYLOAD_BYTES + headroom.
      'grpc.max_send_message_length': 512 * 1024,
      'grpc.max_receive_message_length': 64 * 1024,
    });
    this.openStream();
    this.flushTimer = setInterval(() => this.flush(), this.batchIntervalMs);
    this.flushTimer.unref();
  }

  private openStream(): void {
    if (!this.grpcClient) throw new Error('client not started');
    const callable = (this.grpcClient as unknown as {
      pushEvents(cb: (err: grpc.ServiceError | null, ack: PushAck) => void): grpc.ClientWritableStream<unknown>;
    }).pushEvents.bind(this.grpcClient);
    this.stream = callable((err, ack) => {
      if (err) {
        this.logger.error({ err }, 'federation-stream-error');
        // Resolve all pending with empty ack so the caller can re-enqueue.
        for (const [id, resolve] of this.pendingResolvers) {
          resolve({ accepted: [], rejected: [{ envelopeId: id, code: 'KEY_UNKNOWN', detail: err.message }], ackedAtMs: Date.now() });
        }
        this.pendingResolvers.clear();
        // Reopen on next flush; gRPC channel itself is reconnecting.
        this.stream = null;
        return;
      }
      this.dispatchAck(ack);
    });
  }

  private dispatchAck(ack: PushAck): void {
    for (const id of ack.accepted) {
      const r = this.pendingResolvers.get(id);
      if (r) {
        r(ack);
        this.pendingResolvers.delete(id);
      }
    }
    for (const r of ack.rejected) {
      const f = this.pendingResolvers.get(r.envelopeId);
      if (f) {
        f(ack);
        this.pendingResolvers.delete(r.envelopeId);
      }
    }
  }

  /**
   * Sign and enqueue an envelope. The returned Promise resolves
   * when the core acks the batch this envelope ended up in.
   *
   * The caller should await the Promise before deleting the
   * envelope from its local WAL — at-least-once delivery requires
   * the WAL to outlive the in-flight batch.
   */
  async push(unsigned: EventEnvelopeUnsigned): Promise<PushAck> {
    if (this.closed) throw new Error('client closed');
    if (!this.stream) this.openStream();

    const signature = signEnvelope(unsigned, this.privateKeyPem);
    const envelope: EventEnvelope = {
      ...unsigned,
      signature,
      signingKeyId: this.opts.signingKeyId,
    };
    this.pendingBatch.push(envelope);
    const ackPromise = new Promise<PushAck>((resolve) => {
      this.pendingResolvers.set(unsigned.envelopeId, resolve);
    });
    if (this.pendingBatch.length >= this.batchSize) this.flush();
    return ackPromise;
  }

  private flush(): void {
    if (!this.stream || this.pendingBatch.length === 0) return;
    const batch = this.pendingBatch;
    this.pendingBatch = [];
    for (const env of batch) {
      this.stream.write({
        envelopeId: env.envelopeId,
        region: env.region,
        sourceId: env.sourceId,
        dedupKey: env.dedupKey,
        payload: env.payload,
        observedAtMs: env.observedAtMs,
        signature: env.signature,
        signingKeyId: env.signingKeyId,
      });
    }
  }

  async beacon(req: { agentNowMs: number; agentSeqTotal: number }): Promise<HealthBeaconReply> {
    if (!this.grpcClient) throw new Error('client not started');
    const callable = (this.grpcClient as unknown as {
      healthBeacon(
        req: { region: RegionCode; agentNowMs: number; agentSeqTotal: number },
        cb: (err: grpc.ServiceError | null, reply: HealthBeaconReply) => void,
      ): void;
    }).healthBeacon.bind(this.grpcClient);
    return new Promise<HealthBeaconReply>((resolve, reject) => {
      callable({ region: this.opts.region, ...req }, (err, reply) => {
        if (err) reject(err);
        else resolve(reply);
      });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    if (this.grpcClient) {
      this.grpcClient.close();
      this.grpcClient = null;
    }
  }
}
