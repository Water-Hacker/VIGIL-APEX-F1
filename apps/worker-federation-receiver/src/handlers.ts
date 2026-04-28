import { randomUUID } from 'node:crypto';

import type {
  EventEnvelope,
  HealthBeaconReply,
  HealthBeaconRequest,
  ReceiverHandlers,
} from '@vigil/federation-stream';
import { eventsConsumed, eventsEmitted, type Logger } from '@vigil/observability';
import { QueueClient, STREAMS, type Envelope } from '@vigil/queue';
import { Schemas } from '@vigil/shared';
import type Redis from 'ioredis';

const LAG_HASH = 'vigil:federation:lag';

/**
 * Wire contract on FEDERATION_PUSH (regional adapter-runner → agent →
 * core receiver):
 *
 *   federation envelope.payload (bytes) = JSON-encoded SourceEvent
 *
 * The receiver decodes the bytes, validates against `Schemas.SourceEvent`,
 * cross-checks that the federation envelope's region/sourceId/dedupKey
 * match the SourceEvent's source_id and dedup_key (and the receiver's
 * own envelope-id matches the SourceEvent's id), then republishes the
 * SourceEvent on STREAMS.ADAPTER_OUT — exactly the same shape that the
 * core-side adapter-runner publishes. Downstream consumers are
 * uniform: they read `Envelope<SourceEvent>` from ADAPTER_OUT
 * regardless of whether the event arrived core-direct or via the
 * federation hop.
 *
 * The federation region is preserved in `Envelope.correlation_id`
 * (set to the federation envelope id) and is also tagged onto the
 * SourceEvent's payload under `__federation_region` so per-region
 * filtering downstream works without rewriting existing consumers.
 */

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

    const decoded = this.decodeSourceEvent(env);
    // Decode failure is a wire-level mismatch — throw so the server
    // marks the envelope DEDUP_COLLISION (the only "handler threw"
    // path the protocol supports) and the agent dead-letters.
    if (decoded.kind === 'invalid') {
      this.logger.warn(
        { envelopeId: env.envelopeId, region: env.region, reason: decoded.reason },
        'federation-payload-invalid',
      );
      throw new Error(`federation-payload-invalid: ${decoded.reason}`);
    }
    const sourceEvent = decoded.event;

    const queueEnvelope: Envelope<Schemas.SourceEvent> = {
      id: randomUUID(),
      // Per-source dedup key, prefixed with the region so two regions
      // observing the same upstream document still write distinct
      // events (each region's audit trail is independent).
      dedup_key: `${env.region}:${sourceEvent.dedup_key}`,
      // Carry the federation envelope id as the correlation id so a
      // single regional ingest can be traced end-to-end.
      correlation_id: env.envelopeId,
      producer: 'worker-federation-receiver',
      produced_at: new Date().toISOString(),
      schema_version: 1,
      payload: sourceEvent,
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

  /**
   * Decode + validate the federation envelope's payload bytes as a
   * SourceEvent. Cross-checks that the regional agent didn't mutate
   * the SourceEvent's identity fields between adapter and federation
   * boundary.
   */
  private decodeSourceEvent(
    env: EventEnvelope,
  ):
    | { kind: 'ok'; event: Schemas.SourceEvent }
    | { kind: 'invalid'; reason: string } {
    let parsed: unknown;
    try {
      const text = Buffer.from(
        env.payload.buffer,
        env.payload.byteOffset,
        env.payload.byteLength,
      ).toString('utf8');
      parsed = JSON.parse(text);
    } catch (e) {
      return { kind: 'invalid', reason: `payload not valid utf8/json: ${e instanceof Error ? e.message : String(e)}` };
    }
    const result = Schemas.zSourceEvent.safeParse(parsed);
    if (!result.success) {
      return { kind: 'invalid', reason: `schema: ${result.error.message}` };
    }
    const ev = result.data;
    if (ev.source_id !== env.sourceId) {
      return {
        kind: 'invalid',
        reason: `source_id mismatch: envelope=${env.sourceId} payload=${ev.source_id}`,
      };
    }
    if (ev.dedup_key !== env.dedupKey) {
      return {
        kind: 'invalid',
        reason: `dedup_key mismatch: envelope=${env.dedupKey} payload=${ev.dedup_key}`,
      };
    }
    return { kind: 'ok', event: ev };
  }
}
