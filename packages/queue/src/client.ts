import { readFileSync } from 'node:fs';

import { createLogger, redisStreamLength, type Logger } from '@vigil/observability';
import { Errors } from '@vigil/shared';
import IORedis, { type Redis, type RedisOptions } from 'ioredis';

import type { Envelope } from './types.js';

/**
 * Read the Redis password from the secret-init mounted file. Resolution
 * order:
 *   1. explicit `passwordFile` option
 *   2. REDIS_PASSWORD_FILE env (mount provided by the secret-init container)
 *   3. /run/secrets/redis_password (Docker secrets default mount)
 * If none are present we return null and connect anonymously — Redis
 * will reject on AUTH-required clusters, which is the loud failure
 * mode we want.
 *
 * Per `docs/runbooks/secret-rotation.md` (mode 9.2 closure), this function
 * is called EXACTLY ONCE from `QueueClient`'s constructor. A rotated Redis
 * password requires the worker process to restart — there is no in-process
 * watcher. The function itself re-reads the file on every invocation (no
 * caching here), but only the constructor invokes it. Hot-reload via a
 * Vault Agent sidecar was considered + deferred per orientation Q4.
 *
 * Exported for the secret-rotation contract test in `__tests__/secret-rotation.test.ts`.
 */
export function loadRedisPassword(explicit: string | undefined): string | null {
  const candidates = [
    explicit,
    process.env.REDIS_PASSWORD_FILE,
    '/run/secrets/redis_password',
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf8').trim();
      if (raw) return raw;
    } catch {
      // try next candidate
    }
  }
  return process.env.REDIS_PASSWORD ?? null;
}

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
    const password = loadRedisPassword(opts.passwordFile);
    if (password !== null) options.password = password;

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

    this.redis.on('error', (e) => {
      const err = e instanceof Error ? e : new Error(String(e));
      this.logger.error({ err_name: err.name, err_message: err.message }, 'redis-error');
    });
    this.redis.on('close', () => this.logger.warn('redis-close'));
    this.redis.on('reconnecting', () => this.logger.warn('redis-reconnecting'));
  }

  async ping(): Promise<void> {
    const r = await this.redis.ping();
    if (r !== 'PONG')
      throw new Errors.VigilError({ code: 'REDIS_PING', message: `unexpected: ${r}` });
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

  /**
   * Hardening mode 6.8 — read XLEN for a stream and update the
   * `vigil_redis_stream_length{stream}` Prometheus gauge. Callers
   * typically wrap this in `startRedisStreamScraper` (below) so the
   * gauge is refreshed periodically.
   */
  async sampleStreamLength(stream: string): Promise<number> {
    const len = await this.redis.xlen(stream);
    redisStreamLength.set({ stream }, len);
    return len;
  }
}

/**
 * Hardening mode 6.8 — periodic scraper for stream-length gauges.
 *
 * Pre-closure, Redis streams were trimmed at MAXLEN=1M but operators
 * had no visibility on how close any stream was to the cap until a
 * worker errored. This scraper polls XLEN per registered stream
 * every `intervalMs` (default 30s) and writes the
 * `vigil_redis_stream_length{stream}` gauge.
 *
 * Returns a stop() function so the worker can clean up on shutdown.
 * The interval is `unref`'d so it never holds the event loop open
 * for tests / clean exits.
 */
export interface RedisStreamScraperOptions {
  readonly intervalMs?: number;
  readonly streams: ReadonlyArray<string>;
  readonly logger?: Logger;
}

export function startRedisStreamScraper(
  client: QueueClient,
  opts: RedisStreamScraperOptions,
): { stop: () => void } {
  const logger = opts.logger ?? createLogger({ service: 'queue-scraper' });
  const intervalMs = opts.intervalMs ?? 30_000;
  const tick = async (): Promise<void> => {
    for (const s of opts.streams) {
      try {
        await client.sampleStreamLength(s);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        logger.warn(
          { err_name: e.name, err_message: e.message, stream: s },
          'redis-stream-scrape-failed',
        );
      }
    }
  };
  // Fire once immediately so the gauge is populated at boot.
  void tick();
  const handle = setInterval(() => void tick(), intervalMs);
  handle.unref?.();
  return {
    stop(): void {
      clearInterval(handle);
    },
  };
}
