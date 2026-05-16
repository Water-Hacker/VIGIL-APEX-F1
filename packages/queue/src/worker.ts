import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  createLogger,
  dedupHits,
  errorsTotal,
  eventsConsumed,
  eventsEmitted,
  processingDuration,
  redisAckLatency,
  registerShutdown,
  RetryBudget,
  withCorrelation,
  workerLastTickSeconds,
  type Logger,
} from '@vigil/observability';
import { Errors, Ids, Time } from '@vigil/shared';
import { z } from 'zod';

import { STREAMS, consumerName, groupName, type StreamName } from './streams.js';

import type { QueueClient } from './client.js';
import type { Envelope, HandlerOutcome, WorkerHandler } from './types.js';

/**
 * Atomic dedup-and-ack: collapses the two-RTT (SET NX, XACK) duplicate
 * path into one Redis call. Returns 1 if this is a first delivery (caller
 * proceeds to handle); 0 if duplicate (XACK already issued by Lua).
 *   KEYS[1] = dedup key
 *   KEYS[2] = stream name
 *   ARGV[1] = consumer-group name
 *   ARGV[2] = stream message id
 *   ARGV[3] = TTL seconds (string)
 */
const DEDUP_AND_ACK_LUA = `
  local set = redis.call('SET', KEYS[1], '1', 'EX', tonumber(ARGV[3]), 'NX')
  if set then
    return 1
  else
    redis.call('XACK', KEYS[2], ARGV[1], ARGV[2])
    return 0
  end
`;

/* =============================================================================
 * WorkerBase — extend this; implement only `handle()`.
 *
 * Lifecycle:
 *   start() → consume loop → ensureGroup → XREADGROUP → handle → ack/retry/dlq
 *
 * Crash recovery (SRD §15.3): every 5 min, XAUTOCLAIM idle pending messages
 * from dead consumer instances; this worker takes them over. Idempotency at
 * the dedup_key boundary makes re-delivery safe.
 *
 * Backpressure: bounded in-flight count via a semaphore; new messages are
 * not pulled when the limit is reached. Dead-letter on >= maxRetries.
 * ===========================================================================*/

export interface WorkerBaseConfig<TPayload> {
  readonly name: string;
  readonly stream: StreamName;
  readonly schema: z.ZodType<TPayload, z.ZodTypeDef, unknown>;
  readonly client: QueueClient;
  readonly logger?: Logger;
  /** Max in-flight messages. Default 8. */
  readonly concurrency?: number;
  /** Max times a single message may be redelivered before dead-letter. */
  readonly maxRetries?: number;
  /** XREADGROUP block timeout (ms). */
  readonly blockMs?: number;
  /** Reclaim idle pending messages after this many ms. */
  readonly idleReclaimMs?: number;
  /** Schema version handled. */
  readonly schemaVersion?: number;
  /**
   * AUDIT-047: optional Clock for deterministic tests. Defaults to
   * `Time.systemClock`. Used for the error-window GC, the
   * adaptive-concurrency circuit, dead-letter envelope timestamps,
   * and the redisAckLatency histogram.
   */
  readonly clock?: Time.Clock;
  /**
   * Mode 1.5 — central retry-budget gate. The worker's retry path is
   * checked against a Redis-backed sliding-window counter. When the
   * worker's retry rate exceeds the budget, retries are converted to
   * dead-letters with reason `retry-budget-exhausted: ...`.
   *
   * Defaults: maxPerWindow=120 (2/sec average), windowSeconds=60.
   * Budget name = worker name; surfaces in
   * vigil_retry_budget_exhausted_total{name=<worker>}.
   *
   * Set `enabled: false` to opt out (the worker reverts to unlimited
   * retries up to maxRetries). Set `maxPerWindow` to override the
   * default ceiling — e.g. for a worker known to handle bursts
   * legitimately above 120/min.
   */
  readonly retryBudget?: {
    readonly enabled?: boolean;
    readonly maxPerWindow?: number;
    readonly windowSeconds?: number;
  };
}

export abstract class WorkerBase<TPayload> {
  protected readonly logger: Logger;
  protected readonly config: Required<
    Omit<WorkerBaseConfig<TPayload>, 'logger' | 'schemaVersion' | 'clock' | 'retryBudget'>
  > & {
    schemaVersion: number;
  };
  // AUDIT-047: single clock for all time-dependent worker logic.
  private readonly clock: Time.Clock;
  private readonly instanceId: string;
  private inFlight = 0;
  private running = false;
  private stopping = false;
  // AUDIT-057: last-tick marker for /healthz / /readyz wiring at the
  // app layer. Updated every iteration of loopReadGroup; isHealthy()
  // reports true if the loop ticked within `blockMs * 2`.
  private lastTickAtMs = 0;

  // Phase D9 — adaptive concurrency. We start at the configured ceiling
  // and degrade proportionally to the rolling 60s error rate. Token-
  // bucket style: effective concurrency = ceil × max(0.1, 1 - errorRate).
  // Recovers automatically when errorRate drops back under threshold.
  private readonly errorWindow: { at: number; ok: boolean }[] = [];
  private readonly errorWindowMs = 60_000;
  private circuitOpenUntil = 0;

  // Mode 1.5 — retry-budget gate; null when the worker opted out.
  private readonly retryBudget: RetryBudget | null;

  constructor(cfg: WorkerBaseConfig<TPayload>) {
    this.logger = cfg.logger ?? createLogger({ service: cfg.name });
    this.clock = cfg.clock ?? Time.systemClock;
    // Tier-21 audit closure: HARDEN-#7 forbids Math.random for any
    // operation that could be measured. The consumer-group name is
    // derived from this id — collision would corrupt pending-message
    // accounting in XAUTOCLAIM (two workers thinking they own the
    // same redisId). Switch to crypto.randomBytes for collision
    // resistance.
    this.instanceId = `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;
    this.config = {
      ...cfg,
      concurrency: cfg.concurrency ?? 8,
      maxRetries: cfg.maxRetries ?? 5,
      blockMs: cfg.blockMs ?? Number(process.env.REDIS_STREAM_BLOCK_MS ?? 5000),
      idleReclaimMs:
        cfg.idleReclaimMs ?? Number(process.env.REDIS_CONSUMER_IDLE_RECLAIM_MS ?? 300_000),
      schemaVersion: cfg.schemaVersion ?? 1,
    };
    // Always-on by default. The `enabled: false` escape hatch is for
    // workers (e.g. integration tests with synthetic high burst) where
    // the budget would interfere with intent.
    const budgetEnabled = cfg.retryBudget?.enabled !== false;
    this.retryBudget = budgetEnabled
      ? new RetryBudget(cfg.client.redis, {
          name: cfg.name,
          maxPerWindow: cfg.retryBudget?.maxPerWindow ?? 120,
          windowSeconds: cfg.retryBudget?.windowSeconds ?? 60,
        })
      : null;
  }

  /**
   * Effective concurrency for the next read. Multiplies the configured
   * ceiling by (1 - errorRate) with a 10% floor so we never starve the
   * worker entirely. While the half-open probe window is active (60s
   * after the last 100% error), we cap at 1 to gently re-explore.
   */
  private effectiveConcurrency(): number {
    const cfg = this.config.concurrency;
    const now = this.clock.now();
    while (this.errorWindow.length && now - this.errorWindow[0]!.at > this.errorWindowMs) {
      this.errorWindow.shift();
    }
    if (this.errorWindow.length === 0) return cfg;
    const errs = this.errorWindow.filter((e) => !e.ok).length;
    const errorRate = errs / this.errorWindow.length;
    if (now < this.circuitOpenUntil) return 1;
    if (errorRate >= 0.9) {
      this.circuitOpenUntil = now + 60_000;
      this.logger.warn({ errorRate }, 'worker-circuit-half-open');
      return 1;
    }
    return Math.max(1, Math.floor(cfg * Math.max(0.1, 1 - errorRate)));
  }

  protected recordOutcome(ok: boolean): void {
    this.errorWindow.push({ at: this.clock.now(), ok });
    if (this.errorWindow.length > 200) this.errorWindow.shift();
  }

  /** Implement the unit of work. MUST be idempotent at dedup_key. */
  protected abstract handle(envelope: Envelope<TPayload>): Promise<HandlerOutcome>;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const { client, stream, name } = this.config;

    await client.ensureGroup(stream, groupName(name));

    registerShutdown(`worker:${name}`, async () => this.stop());

    this.logger.info(
      { stream, group: groupName(name), instance: this.instanceId },
      'worker-started',
    );

    void this.loopReadGroup();
    void this.loopReclaim();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    // Wait for in-flight work to drain (capped externally by shutdown harness)
    while (this.inFlight > 0) {
      await sleep(50);
    }
    this.running = false;
    this.logger.info('worker-stopped');
  }

  /**
   * AUDIT-057: lightweight readiness check. Returns true if the
   * consume-loop has ticked within `blockMs * 2` of `clock.now()`.
   * App-layer code wires this into a `http.createServer` /healthz
   * handler — see worker apps' main() for the pattern.
   */
  isHealthy(): boolean {
    if (!this.running) return false;
    if (this.lastTickAtMs === 0) return true; // boot grace
    const now = this.clock.now();
    const stalenessThresholdMs = this.config.blockMs * 2;
    return now - this.lastTickAtMs <= stalenessThresholdMs;
  }

  private async loopReadGroup(): Promise<void> {
    const { client, stream, name, blockMs } = this.config;
    const cName = consumerName(name, this.instanceId);

    while (this.running && !this.stopping) {
      this.lastTickAtMs = this.clock.now();
      // AUDIT-076 — surface lastTick to Prometheus so a generic
      // worker-stalled alert can fire without per-worker handcrafting.
      workerLastTickSeconds.labels({ worker: name }).set(this.lastTickAtMs / 1000);
      try {
        // Don't pull more than the (adaptive) concurrency permits.
        const slots = Math.max(0, this.effectiveConcurrency() - this.inFlight);
        if (slots === 0) {
          await sleep(50);
          continue;
        }
        const res = (await client.redis.xreadgroup(
          'GROUP',
          groupName(name),
          cName,
          'COUNT',
          slots,
          'BLOCK',
          blockMs,
          'STREAMS',
          stream,
          '>',
        )) as Array<[string, Array<[string, string[]]>]> | null;

        if (res === null) continue;
        for (const [, entries] of res) {
          for (const [redisId, fields] of entries) {
            const body = this.fieldsToBody(fields);
            void this.process(redisId, body);
          }
        }
      } catch (e) {
        // Tier-3 audit: normalise non-Error throwables so the logger
        // serializes a meaningful err_name/err_message instead of an
        // opaque "[object Object]" or undefined `.message`. Pattern
        // matches the closure in PR #15 (StartupGuard / pin-image-digests).
        const err = e instanceof Error ? e : new Error(String(e));
        this.logger.error({ err_name: err.name, err_message: err.message }, 'read-group-error');
        await sleep(1000);
      }
    }
  }

  private async loopReclaim(): Promise<void> {
    const { client, stream, name, idleReclaimMs } = this.config;
    while (this.running && !this.stopping) {
      try {
        // XAUTOCLAIM messages older than idleReclaimMs from dead consumers
        const res = (await client.redis.xautoclaim(
          stream,
          groupName(name),
          consumerName(name, this.instanceId),
          idleReclaimMs,
          '0',
          'COUNT',
          10,
        )) as [string, Array<[string, string[]]>, string[]];
        const [, claimed] = res;
        for (const [redisId, fields] of claimed) {
          const body = this.fieldsToBody(fields);
          this.logger.warn({ redisId }, 'reclaimed-stale-message');
          void this.process(redisId, body);
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        this.logger.error({ err_name: err.name, err_message: err.message }, 'autoclaim-error');
      }
      await sleep(idleReclaimMs);
    }
  }

  private async process(redisId: string, body: string): Promise<void> {
    const { client, stream, name, schema, schemaVersion } = this.config;

    this.inFlight++;
    const enqueuedAt = this.clock.now();

    try {
      eventsConsumed.labels({ worker: name, stream }).inc();

      let envelope: Envelope<TPayload>;
      try {
        const raw = JSON.parse(body) as Record<string, unknown>;
        if (raw['schema_version'] !== schemaVersion) {
          this.logger.warn(
            { id: raw['id'], expected: schemaVersion, got: raw['schema_version'] },
            'schema-version-mismatch',
          );
        }
        envelope = {
          id: String(raw['id']),
          dedup_key: String(raw['dedup_key']),
          correlation_id: String(raw['correlation_id']),
          producer: String(raw['producer']),
          produced_at: String(raw['produced_at']),
          schema_version: Number(raw['schema_version']),
          payload: schema.parse(raw['payload']),
        };
      } catch (e) {
        errorsTotal.labels({ service: name, code: 'PARSE', severity: 'error' }).inc();
        const err = e instanceof Error ? e : new Error(String(e));
        this.logger.error(
          { err_name: err.name, err_message: err.message, redisId },
          'envelope-parse-failed',
        );
        await this.deadLetter(redisId, body, 'envelope-parse-failed');
        return;
      }

      // Idempotency: dedup_key MUST be unique. If we've seen this key, ack
      // and move on. Phase D4 — combined into a single Redis round-trip
      // via a Lua script: previously two RTTs (SET then XACK), now one
      // for the duplicate path (still just one for the first-delivery
      // path). Saves ~50 % Redis bandwidth on duplicate-heavy streams.
      const dedupKey = `vigil:dedup:${name}:${envelope.dedup_key}`;
      const dedupResult = (await client.redis.eval(
        DEDUP_AND_ACK_LUA,
        2,
        dedupKey,
        stream,
        groupName(name),
        redisId,
        '86400',
      )) as number;
      // 1 = first delivery (SET happened; we proceed), 0 = duplicate (XACK already done by Lua)
      if (dedupResult === 0) {
        dedupHits.labels({ worker: name }).inc();
        return;
      }

      const endTimer = processingDuration.labels({ worker: name, kind: stream }).startTimer();
      const outcome = await withCorrelation(envelope.correlation_id, name, () =>
        this.handle(envelope),
      );
      endTimer();

      switch (outcome.kind) {
        case 'ack':
          await client.redis.xack(stream, groupName(name), redisId);
          eventsEmitted.labels({ worker: name, stream }).inc();
          redisAckLatency.labels({ worker: name }).observe((this.clock.now() - enqueuedAt) / 1000);
          this.recordOutcome(true);
          break;
        case 'retry':
          // Mode 1.5 — retry-budget gate. If the worker's retry rate
          // has exceeded its sliding-window ceiling, convert the retry
          // to a dead-letter so a downstream outage can't pull the
          // queue into a retry storm. Budget instance is shared across
          // worker replicas via Redis-backed counters.
          if (this.retryBudget !== null) {
            const reserve = await this.retryBudget.tryReserve();
            if (!reserve.allowed) {
              this.logger.error(
                {
                  redisId,
                  reason: outcome.reason,
                  budgetName: name,
                  current: reserve.current,
                  ceiling: reserve.ceiling,
                },
                'handler-retry-budget-exhausted-deadletter',
              );
              await this.deadLetterAndAck(
                redisId,
                body,
                `retry-budget-exhausted: ${outcome.reason}`,
              );
              this.recordOutcome(false);
              break;
            }
          }
          this.logger.warn({ redisId, reason: outcome.reason }, 'handler-retry');
          // Tier-21 audit closure: release the dedup lock BEFORE the
          // optional retry-delay sleep. Pre-fix order was sleep → del,
          // so a worker crash during the sleep window left the dedup
          // key live for 24 h while the message remained un-ACKed in
          // the consumer-group's pending list. On the next pending
          // reclaim, the dedup-and-ack Lua saw the existing key and
          // XACKed the message — silently dropping the intended retry.
          // del-before-sleep means a crash during sleep is recoverable
          // (next pending reclaim retries cleanly).
          await client.redis.del(dedupKey);
          // Don't ACK — Redis will redeliver after pending-idle time
          if (outcome.delay_ms !== undefined && outcome.delay_ms > 0) {
            await sleep(outcome.delay_ms);
          }
          this.recordOutcome(false);
          break;
        case 'dead-letter':
          this.logger.error({ redisId, reason: outcome.reason }, 'handler-dead-letter');
          await this.deadLetterAndAck(redisId, body, outcome.reason);
          this.recordOutcome(false);
          break;
      }
    } catch (e) {
      const ve = Errors.asVigilError(e);
      errorsTotal.labels({ service: name, code: ve.code, severity: ve.severity }).inc();
      this.logger.error(
        { err_name: ve.name, err_message: ve.message, err_code: ve.code, redisId },
        'handler-threw',
      );
      // Generic exception — push to DLQ; ACK so it doesn't loop forever.
      await this.deadLetterAndAck(redisId, body, ve.message);
      this.recordOutcome(false);
    } finally {
      this.inFlight--;
    }
  }

  private async deadLetter(redisId: string, body: string, reason: string): Promise<void> {
    const { client, name, stream } = this.config;
    const dlEnvelope = {
      id: Ids.newEventId() as string,
      dedup_key: `dlq:${name}:${redisId}`,
      correlation_id: Ids.newCorrelationId() as string,
      producer: name,
      produced_at: this.clock.isoNow(),
      schema_version: 1,
      payload: {
        original_stream: stream,
        original_redis_id: redisId,
        original_body: body,
        reason,
        worker: name,
      },
    };
    await client.publish(STREAMS.DEAD_LETTER, dlEnvelope);
  }

  /**
   * Pipeline the dead-letter publish and the originating XACK. Single
   * Redis round-trip instead of two; the DLQ XADD and the upstream
   * XACK are independent (no causal dependency at the wire level —
   * worst case a partial pipeline replays the dead-letter once which
   * is harmless: DLQ consumers dedupe on `dlq:<worker>:<redisId>`).
   */
  private async deadLetterAndAck(redisId: string, body: string, reason: string): Promise<void> {
    const { client, name, stream } = this.config;
    const dlEnvelope = {
      id: Ids.newEventId() as string,
      dedup_key: `dlq:${name}:${redisId}`,
      correlation_id: Ids.newCorrelationId() as string,
      producer: name,
      produced_at: this.clock.isoNow(),
      schema_version: 1,
      payload: {
        original_stream: stream,
        original_redis_id: redisId,
        original_body: body,
        reason,
        worker: name,
      },
    };
    const dlBody = JSON.stringify(dlEnvelope);
    await client.redis
      .pipeline()
      .xadd(STREAMS.DEAD_LETTER, '*', 'body', dlBody)
      .xack(stream, groupName(name), redisId)
      .exec();
  }

  private fieldsToBody(fields: string[]): string {
    // Redis returns alternating field/value pairs; we always set 'body' = JSON
    for (let i = 0; i + 1 < fields.length; i += 2) {
      if (fields[i] === 'body') return fields[i + 1] ?? '{}';
    }
    return '{}';
  }
}

/** Helper: build an envelope from a payload — workers use this when emitting. */
export function newEnvelope<T>(
  producer: string,
  payload: T,
  dedupKey: string,
  correlationId?: string,
): Envelope<T> {
  return {
    id: Ids.newEventId() as string,
    dedup_key: dedupKey,
    correlation_id: correlationId ?? (Ids.newCorrelationId() as string),
    producer,
    produced_at: new Date().toISOString(),
    schema_version: 1,
    payload,
  };
}

export type { WorkerHandler };
