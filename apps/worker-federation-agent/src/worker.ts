import {
  ALL_REGION_CODES,
  FederationStreamClient,
  type RegionCode,
} from '@vigil/federation-stream';
import { eventsConsumed, eventsEmitted, type Logger } from '@vigil/observability';
import {
  QueueClient,
  STREAMS,
  WorkerBase,
  type Envelope,
  type HandlerOutcome,
} from '@vigil/queue';
import { z } from 'zod';

/**
 * Queue payload shape — what the regional adapter-runner writes onto
 * STREAMS.FEDERATION_PUSH. Mirrors `EventEnvelopeUnsigned` from
 * @vigil/federation-stream with `payload` carried as base64 (Redis
 * streams are string-typed; the adapter encodes its bytes once).
 */
const zPayload = z.object({
  envelopeId: z.string().min(1),
  region: z.enum(ALL_REGION_CODES as readonly [RegionCode, ...RegionCode[]]),
  sourceId: z.string().min(1),
  dedupKey: z.string().min(1),
  payloadB64: z.string().min(1),
  observedAtMs: z.number().int().nonnegative(),
});
export type FederationPushPayload = z.infer<typeof zPayload>;
export const federationPushSchema = zPayload;

export interface FederationAgentDeps {
  readonly client: FederationStreamClient;
  readonly queue: QueueClient;
  readonly logger: Logger;
  readonly region: RegionCode;
}

/**
 * The regional federation agent.
 *
 * For each Redis-stream message:
 *   1. Decode the base64 payload back to bytes.
 *   2. Hand the unsigned envelope to FederationStreamClient.push().
 *   3. Await the per-batch PushAck this envelope ends up in.
 *   4. Map the ack into a queue HandlerOutcome:
 *        accepted     -> ack
 *        SIGNATURE_INVALID / REGION_MISMATCH -> dead-letter (configuration bug;
 *                                                no point retrying)
 *        REPLAY_WINDOW / PAYLOAD_TOO_LARGE   -> dead-letter (data bug)
 *        KEY_UNKNOWN  -> retry (the core's resolver may catch up)
 *        DEDUP_COLLISION -> ack (already-seen on the core; safe to drop)
 *        anything else -> retry
 *
 * The mapping is deliberate: rejection codes that signal a *configuration* or
 * *data* fault dead-letter (no infinite-loop). Codes that signal a *transient*
 * core-side condition retry through the queue's own backoff.
 */
export class FederationAgentWorker extends WorkerBase<FederationPushPayload> {
  private readonly client: FederationStreamClient;
  private readonly region: RegionCode;

  constructor(deps: FederationAgentDeps) {
    super({
      name: 'worker-federation-agent',
      stream: STREAMS.FEDERATION_PUSH,
      schema: zPayload,
      client: deps.queue,
      logger: deps.logger,
      // The federation client batches internally (default 256 envelopes
      // or 2 s). Per-message concurrency on the queue side is therefore
      // a queue-prefetch knob, not a true parallelism — set to the same
      // batch size so we keep the federation client's batch full.
      concurrency: 256,
      maxRetries: 8,
    });
    this.client = deps.client;
    this.region = deps.region;
  }

  protected async handle(env: Envelope<FederationPushPayload>): Promise<HandlerOutcome> {
    eventsConsumed.labels({ worker: 'worker-federation-agent', stream: STREAMS.FEDERATION_PUSH }).inc();

    if (env.payload.region !== this.region) {
      // The regional adapter-runner wrote a payload with the wrong region.
      // Dead-letter — this is a configuration bug, not a transient fault.
      return {
        kind: 'dead-letter',
        reason: `region-mismatch payload=${env.payload.region} agent=${this.region}`,
      };
    }

    let payload: Uint8Array;
    try {
      payload = Buffer.from(env.payload.payloadB64, 'base64');
    } catch {
      return { kind: 'dead-letter', reason: 'payload not valid base64' };
    }

    const ack = await this.client.push({
      envelopeId: env.payload.envelopeId,
      region: env.payload.region,
      sourceId: env.payload.sourceId,
      dedupKey: env.payload.dedupKey,
      payload,
      observedAtMs: env.payload.observedAtMs,
    });

    if (ack.accepted.includes(env.payload.envelopeId)) {
      eventsEmitted.labels({ worker: 'worker-federation-agent', stream: 'federation-stream' }).inc();
      return { kind: 'ack' };
    }

    const rejected = ack.rejected.find((r) => r.envelopeId === env.payload.envelopeId);
    if (!rejected) {
      // Neither accepted nor rejected — treat as transient. The core will
      // re-ack on the next batch.
      return { kind: 'retry', reason: 'envelope not in batch ack' };
    }

    switch (rejected.code) {
      case 'KEY_UNKNOWN':
        // The core's KeyResolver may not have seen our cert yet — retry.
        return { kind: 'retry', reason: `core-key-unknown: ${rejected.detail ?? ''}` };
      case 'DEDUP_COLLISION':
        // The core has already seen an envelope with this dedup_key — safe
        // to drop on the regional side.
        return { kind: 'ack' };
      case 'SIGNATURE_INVALID':
      case 'REGION_MISMATCH':
      case 'REPLAY_WINDOW':
      case 'PAYLOAD_TOO_LARGE':
      default:
        return { kind: 'dead-letter', reason: `${rejected.code}: ${rejected.detail ?? ''}` };
    }
  }
}
