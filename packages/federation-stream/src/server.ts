import { resolve as resolvePath } from 'node:path';
import { readFileSync } from 'node:fs';

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { createLogger, type Logger } from '@vigil/observability';

import { verifyEnvelopeWithPolicy, type KeyResolver, type ReceiverPolicy } from './verify.js';
import type {
  EventEnvelope,
  HealthBeaconReply,
  HealthBeaconRequest,
  PushAck,
  RegionCode,
  RejectedEnvelope,
} from './types.js';

const PROTO_PATH = resolvePath(__dirname, '..', 'proto', 'federation.proto');

interface FederationGrpcDef {
  vigil: {
    federation: {
      v1: {
        FederationStream: {
          service: grpc.ServiceDefinition;
        };
      };
    };
  };
}

/**
 * Per-batch flush boundary on the receiver side. Acks are sent
 * after this many envelopes OR `ackIntervalMs`, whichever first.
 * Matches the client's defaults so the round-trip is predictable.
 */
const DEFAULT_ACK_BATCH = 256;
const DEFAULT_ACK_INTERVAL_MS = 2_000;

export interface ReceiverHandlers {
  /**
   * Called once for every signature-verified envelope, in stream
   * order. The handler should be idempotent on (region, dedupKey)
   * — the receiver does NOT enforce dedup itself, by design (the
   * dedup window lives in Redis on the core).
   *
   * Throwing from this handler causes the envelope to be marked
   * REJECTED with reason DEDUP_COLLISION (the most common failure
   * here is the dedup-cache returning "already-seen").
   */
  onAccepted(env: EventEnvelope): Promise<void>;

  /**
   * Called once per HealthBeacon request. Returns the reply that
   * goes back to the agent. Implementations typically read from
   * the same dedup-cache as onAccepted to compute lag.
   */
  onBeacon(req: HealthBeaconRequest): Promise<HealthBeaconReply>;
}

export interface FederationServerOptions {
  readonly listenAddress: string; // e.g. "0.0.0.0:9443"
  readonly tlsCertPath: string;
  readonly tlsKeyPath: string;
  /** Optional CA bundle for mTLS. If set, clients must present a cert. */
  readonly clientCaPath?: string;
  readonly keyResolver: KeyResolver;
  readonly handlers: ReceiverHandlers;
  readonly policy?: ReceiverPolicy;
  readonly logger?: Logger;
  readonly ackBatchSize?: number;
  readonly ackIntervalMs?: number;
}

export class FederationStreamServer {
  private readonly logger: Logger;
  private readonly server: grpc.Server;
  private readonly ackBatchSize: number;
  private readonly ackIntervalMs: number;

  constructor(private readonly opts: FederationServerOptions) {
    this.logger = opts.logger ?? createLogger({ service: 'federation-stream-server' });
    this.ackBatchSize = opts.ackBatchSize ?? DEFAULT_ACK_BATCH;
    this.ackIntervalMs = opts.ackIntervalMs ?? DEFAULT_ACK_INTERVAL_MS;
    this.server = new grpc.Server({
      'grpc.max_receive_message_length': 512 * 1024,
      'grpc.max_send_message_length': 64 * 1024,
    });
    this.bindService();
  }

  private bindService(): void {
    const def = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const pkg = grpc.loadPackageDefinition(def) as unknown as FederationGrpcDef;
    const service = pkg.vigil.federation.v1.FederationStream.service;
    this.server.addService(service, {
      pushEvents: this.handlePushEvents.bind(this),
      healthBeacon: this.handleHealthBeacon.bind(this),
    } as grpc.UntypedServiceImplementation);
  }

  private handlePushEvents(
    call: grpc.ServerReadableStream<EventEnvelope, PushAck>,
    callback: grpc.sendUnaryData<PushAck>,
  ): void {
    const accepted: string[] = [];
    const rejected: RejectedEnvelope[] = [];
    let lastFlushAt = Date.now();
    let inflight = Promise.resolve();

    const flushIfDue = (): void => {
      const due =
        accepted.length + rejected.length >= this.ackBatchSize ||
        Date.now() - lastFlushAt >= this.ackIntervalMs;
      if (!due) return;
      // We don't flush mid-stream — gRPC's client-streaming is
      // single-response. Acks accumulate and ship in `end`.
      lastFlushAt = Date.now();
    };

    call.on('data', (env: EventEnvelope) => {
      inflight = inflight.then(async () => {
        const result = await verifyEnvelopeWithPolicy(env, this.opts.keyResolver, this.opts.policy);
        if (!result.ok) {
          rejected.push({
            envelopeId: env.envelopeId,
            code: result.code ?? 'SIGNATURE_INVALID',
            detail: result.detail,
          });
          this.logger.warn(
            { envelopeId: env.envelopeId, code: result.code, detail: result.detail, region: env.region },
            'federation-envelope-rejected',
          );
          return;
        }
        try {
          await this.opts.handlers.onAccepted(env);
          accepted.push(env.envelopeId);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          rejected.push({ envelopeId: env.envelopeId, code: 'DEDUP_COLLISION', detail });
        }
        flushIfDue();
      });
    });

    call.on('error', (err) => {
      this.logger.error({ err }, 'federation-stream-call-error');
    });

    call.on('end', () => {
      void inflight.then(() => {
        callback(null, {
          accepted,
          rejected,
          ackedAtMs: Date.now(),
        });
      });
    });
  }

  private handleHealthBeacon(
    call: grpc.ServerUnaryCall<HealthBeaconRequest, HealthBeaconReply>,
    callback: grpc.sendUnaryData<HealthBeaconReply>,
  ): void {
    void this.opts.handlers
      .onBeacon(call.request)
      .then((reply) => callback(null, reply))
      .catch((err) => {
        this.logger.error({ err, region: call.request.region }, 'federation-beacon-error');
        callback({ code: grpc.status.INTERNAL, message: err instanceof Error ? err.message : 'beacon failed' } as grpc.ServiceError, null);
      });
  }

  async start(): Promise<void> {
    const cert = readFileSync(this.opts.tlsCertPath);
    const key = readFileSync(this.opts.tlsKeyPath);
    const clientCa = this.opts.clientCaPath ? readFileSync(this.opts.clientCaPath) : null;
    const credentials = clientCa
      ? grpc.ServerCredentials.createSsl(clientCa, [{ private_key: key, cert_chain: cert }], true)
      : grpc.ServerCredentials.createSsl(null, [{ private_key: key, cert_chain: cert }], false);

    await new Promise<void>((resolve, reject) => {
      this.server.bindAsync(this.opts.listenAddress, credentials, (err, port) => {
        if (err) return reject(err);
        this.logger.info({ port, listen: this.opts.listenAddress }, 'federation-stream-server-started');
        resolve();
      });
    });
  }

  async stop(graceMs = 5_000): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.server.forceShutdown();
        resolve();
      }, graceMs);
      this.server.tryShutdown((err) => {
        clearTimeout(timer);
        if (err) this.logger.warn({ err }, 'federation-stream-server-tryShutdown-error');
        resolve();
      });
    });
  }
}

// Re-export RegionCode here so server consumers can satisfy
// HealthBeaconRequest without crossing back through types.ts.
export type { RegionCode };
