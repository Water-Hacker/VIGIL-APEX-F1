import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

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
  /**
   * TLS root for the core's cert (Vault root CA). Required in
   * production. If omitted the client connects with
   * `grpc.credentials.createInsecure()` — intended only for in-process
   * tests and `kind`-cluster dev boots, paired with a server started
   * without TLS.
   */
  readonly tlsRootCertPath?: string;
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
 *   - new FederationStreamClient(opts) — constructs the channel-
 *     holder but does NOT open it (gRPC channels are lazy).
 *   - client.start() — connects the channel and starts the batch
 *     timer. Idempotent.
 *   - client.push(unsigned) — signs and enqueues into the current
 *     in-flight batch. Returns a Promise that resolves to the
 *     PushAck containing this envelope's id once the batch has
 *     been flushed and acked by the core.
 *   - client.beacon(req) — unary HealthBeacon RPC.
 *   - client.close() — flushes the in-flight batch, awaits its
 *     ack, then closes the channel.
 *
 * Wire model:
 *   PushEvents is `stream EventEnvelope returns (PushAck)` —
 *   client-streaming, single response. Each *batch* opens its own
 *   client-streaming RPC, writes every envelope, then calls end().
 *   The server's PushAck arrives once and is dispatched to every
 *   pending resolver in that batch. Within a single channel,
 *   opening a new HTTP/2 stream is cheap (no TLS handshake).
 *
 *   Earlier design tried a single long-lived stream which
 *   produced exactly one ack at stream-close — incompatible with
 *   per-batch ack semantics. This refactor closed that gap.
 */
export class FederationStreamClient {
  private readonly logger: Logger;
  private readonly batchSize: number;
  private readonly batchIntervalMs: number;
  private readonly privateKeyPem: string;

  private grpcClient: grpc.Client | null = null;
  private pendingBatch: EventEnvelope[] = [];
  private pendingResolvers = new Map<string, (ack: PushAck) => void>();
  private flushTimer: NodeJS.Timeout | null = null;
  private inflightBatch: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly opts: FederationClientOptions) {
    this.logger = opts.logger ?? createLogger({
      service: 'federation-stream-client',
      extraBindings: { region: opts.region },
    });
    this.batchSize = opts.batchSize ?? 256;
    this.batchIntervalMs = opts.batchIntervalMs ?? 2_000;
    this.privateKeyPem = readFileSync(opts.signingPrivateKeyPath, 'utf8');
  }

  start(): void {
    if (this.grpcClient) return;
    const Ctor = loadServiceCtor();
    const credentials = this.opts.tlsRootCertPath
      ? grpc.credentials.createSsl(readFileSync(this.opts.tlsRootCertPath))
      : grpc.credentials.createInsecure();
    this.grpcClient = new Ctor(this.opts.coreEndpoint, credentials, {
      // 30 s keepalive matches the HealthBeacon cadence.
      'grpc.keepalive_time_ms': 30_000,
      'grpc.keepalive_timeout_ms': 10_000,
      'grpc.keepalive_permit_without_calls': 1,
      // Cap message size at MAX_PAYLOAD_BYTES + headroom.
      'grpc.max_send_message_length': 512 * 1024,
      'grpc.max_receive_message_length': 64 * 1024,
    });
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.batchIntervalMs);
    this.flushTimer.unref();
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
    if (this.pendingBatch.length >= this.batchSize) {
      void this.flush();
    }
    return ackPromise;
  }

  /**
   * Open a new client-streaming RPC, send the current batch, await
   * the unary PushAck. Sequenced through `inflightBatch` so two
   * concurrent flush() calls don't race on the same stream.
   */
  private flush(): Promise<void> {
    if (this.pendingBatch.length === 0) return this.inflightBatch;
    if (!this.grpcClient) {
      this.logger.warn('flush-without-start');
      return this.inflightBatch;
    }
    const batch = this.pendingBatch;
    this.pendingBatch = [];
    const resolvers = new Map<string, (ack: PushAck) => void>();
    for (const env of batch) {
      const r = this.pendingResolvers.get(env.envelopeId);
      if (r) {
        resolvers.set(env.envelopeId, r);
        this.pendingResolvers.delete(env.envelopeId);
      }
    }
    const grpcClient = this.grpcClient;

    this.inflightBatch = this.inflightBatch.then(
      () =>
        new Promise<void>((resolve) => {
          const callable = (grpcClient as unknown as {
            pushEvents(
              cb: (err: grpc.ServiceError | null, ack: PushAck) => void,
            ): grpc.ClientWritableStream<unknown>;
          }).pushEvents.bind(grpcClient);
          const stream = callable((err, ack) => {
            if (err) {
              this.logger.error({ err }, 'federation-stream-batch-error');
              const errAck: PushAck = {
                accepted: [],
                rejected: batch.map((b) => ({
                  envelopeId: b.envelopeId,
                  code: 'KEY_UNKNOWN' as const,
                  detail: err.message,
                })),
                ackedAtMs: Date.now(),
              };
              for (const [, r] of resolvers) r(errAck);
              resolve();
              return;
            }
            for (const [, r] of resolvers) r(ack);
            resolve();
          });
          for (const env of batch) {
            stream.write({
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
          stream.end();
        }),
    );
    return this.inflightBatch;
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
    // Flush whatever is queued, then await every in-flight batch RPC
    // (including the one we just kicked off) before tearing down the
    // gRPC channel.
    await this.flush();
    if (this.grpcClient) {
      this.grpcClient.close();
      this.grpcClient = null;
    }
  }
}
