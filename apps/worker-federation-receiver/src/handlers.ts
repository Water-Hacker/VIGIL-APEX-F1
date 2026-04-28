import { randomUUID } from 'node:crypto';

import type {
  EventEnvelope,
  HealthBeaconReply,
  HealthBeaconRequest,
  ReceiverHandlers,
  RegionCode,
} from '@vigil/federation-stream';
import { eventsConsumed, eventsEmitted, type Logger } from '@vigil/observability';
import { QueueClient, STREAMS, type Envelope } from '@vigil/queue';
import type Redis from 'ioredis';

const LAG_HASH = 'vigil:federation:lag';

/**
 * Adapter-out payload shape produced by the federation receiver. The
 * regional adapter-runner already writes this same shape into
 * STREAMS.ADAPTER_OUT directly when running on the core; the regional
 * federation hop simply re-publishes via this worker. Pattern-detect
 * and score workers consume STREAMS.ADAPTER_OUT generically — they do
 * not distinguish core-direct vs federation-relayed events except via
 * the `metadata.federation_region` tag.
 */
export interface AdapterOutPayload {
  readonly source_id: string;
  readonly fetched_at_ms: number;
  readonly body_b64: string;
  readonly metadata: {
    readonly federation_region: RegionCode;
    readonly federation_envelope_id: string;
  };
}

export interface ReceiverHandlersDeps {
  readonly queue: QueueClient;
  readonly redis: Redis;
  readonly logger: Logger;
  /** Optional throttle hint to apply uniformly. Default 0 (no hint). */
  readonly throttleHintMs?: number;
}

export class FederationReceiverHandlers implements ReceiverHandlers {
  private readonly queue: QueueClient;
  private readonly redis: Redis;
  private readonly logger: Logger;
  private readonly throttleHintMs: number;

  constructor(deps: ReceiverHandlersDeps) {
    this.queue = deps.queue;
    this.redis = deps.redis;
    this.logger = deps.logger;
    this.throttleHintMs = deps.throttleHintMs ?? 0;
  }

  async onAccepted(env: EventEnvelope): Promise<void> {
    eventsConsumed.labels({ worker: 'worker-federation-receiver', stream: 'federation-stream' }).inc();

    const payload: AdapterOutPayload = {
      source_id: env.sourceId,
      fetched_at_ms: env.observedAtMs,
      body_b64: Buffer.from(env.payload.buffer, env.payload.byteOffset, env.payload.byteLength).toString('base64'),
      metadata: {
        federation_region: env.region,
        federation_envelope_id: env.envelopeId,
      },
    };

    const queueEnvelope: Envelope<AdapterOutPayload> = {
      id: randomUUID(),
      // The adapter-runner's dedup_key is per-source; we keep the same
      // shape here so the downstream pattern-detect dedup behaves
      // identically whether the event arrived core-direct or via the
      // federation hop.
      dedup_key: `${env.region}:${env.sourceId}:${env.dedupKey}`,
      correlation_id: env.envelopeId,
      producer: 'worker-federation-receiver',
      produced_at: new Date().toISOString(),
      schema_version: 1,
      payload,
    };

    await this.queue.publish(STREAMS.ADAPTER_OUT, queueEnvelope);
    eventsEmitted
      .labels({ worker: 'worker-federation-receiver', stream: STREAMS.ADAPTER_OUT })
      .inc();

    // Track the most recent observed_at for this region so the beacon
    // handler can compute lag without hitting Postgres.
    await this.redis.hset(LAG_HASH, env.region, String(env.observedAtMs));
  }

  async onBeacon(req: HealthBeaconRequest): Promise<HealthBeaconReply> {
    const raw = await this.redis.hget(LAG_HASH, req.region);
    const lastObservedAtMs = raw ? Number(raw) : 0;
    const reply: HealthBeaconReply = {
      lastObservedAtMs,
      coreNowMs: Date.now(),
      throttleHintMs: this.throttleHintMs,
    };
    this.logger.debug(
      { region: req.region, lastObservedAtMs, agentSeqTotal: req.agentSeqTotal },
      'federation-beacon',
    );
    return reply;
  }
}
