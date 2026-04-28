import { createLogger, type Logger } from '@vigil/observability';
import { Errors } from '@vigil/shared';
import IORedis, { type Redis, type RedisOptions } from 'ioredis';

import type { Envelope } from './types.js';

/**
 * Thin wrapper over ioredis that owns connection lifecycle and exposes
 * stream-shaped helpers used by `WorkerBase`.
 */

export interface QueueClientOptions {
  readonly url?: string;
  readonly host?: string;
  readonly port?: number;
  readonly passwordFile?: string;
  readonly db?: number;
  readonly tls?: boolean;
  readonly logger?: Logger;
}

export class QueueClient {
  public readonly redis: Redis;
  private readonly logger: Logger;

  constructor(opts: QueueClientOptions = {}) {
    this.logger = opts.logger ?? createLogger({ service: 'vigil-queue' });

    const options: RedisOptions = {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: false, // fail-fast rather than queue indefinitely
      retryStrategy: (times) => {
        const delay = Math.min(50 * 2 ** times, 5_000);
        this.logger.warn({ attempt: times, delay }, 'redis-reconnect');
        return delay;
      },
      reconnectOnError: (err) => {
        const targets = ['READONLY', 'ECONNRESET'];
        return targets.some((t) => err.message.includes(t));
      },
    };
    if (opts.tls === true) options.tls = {};

    if (opts.url !== undefined) {
      this.redis = new IORedis(opts.url, options);
    } else {
      this.redis = new IORedis({
        host: opts.host ?? 'vigil-redis',
        port: opts.port ?? 6379,
        db: opts.db ?? 0,
        ...options,
      });
    }

    this.redis.on('error', (e) => this.logger.error({ err: e }, 'redis-error'));
    this.redis.on('close', () => this.logger.warn('redis-close'));
    this.redis.on('reconnecting', () => this.logger.warn('redis-reconnecting'));
  }

  async ping(): Promise<void> {
    const r = await this.redis.ping();
    if (r !== 'PONG') throw new Errors.VigilError({ code: 'REDIS_PING', message: `unexpected: ${r}` });
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  /** Ensure a consumer group exists for a stream. Idempotent. */
  async ensureGroup(stream: string, group: string): Promise<void> {
    try {
      // MKSTREAM creates the stream if absent; $ means "from new messages only"
      await this.redis.xgroup('CREATE', stream, group, '$', 'MKSTREAM');
      this.logger.info({ stream, group }, 'consumer-group-created');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('BUSYGROUP')) throw e;
      // Group already exists — fine
    }
  }

  /** Trim a stream to a max length to bound memory. */
  async trim(stream: string, maxLen: number): Promise<number> {
    return this.redis.xtrim(stream, 'MAXLEN', '~', maxLen);
  }

  /** Publish an envelope to a stream. Returns the Redis stream ID. */
  async publish<T>(stream: string, envelope: Envelope<T>): Promise<string> {
    const body = JSON.stringify(envelope);
    return this.redis.xadd(stream, '*', 'body', body) as Promise<string>;
  }
}
