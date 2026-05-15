import { setTimeout as sleep } from 'node:timers/promises';

import { redisStreamLength } from '@vigil/observability';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueueClient, startRedisStreamScraper } from '../src/client.js';

/**
 * Mode 6.8 — Redis stream backpressure scraper.
 *
 * Tests:
 *   1. sampleStreamLength sets the gauge with the XLEN value.
 *   2. startRedisStreamScraper fires once immediately + on every tick.
 *   3. stop() halts further ticks.
 *   4. xlen failures are caught + logged; the scraper keeps running.
 *
 * Uses a stubbed Redis client injected into QueueClient via the
 * structural cast. Same pattern as the mode 2.1 pool-saturation test.
 */

interface RedisStub {
  xlen: ReturnType<typeof vi.fn>;
}

function makeClientWithStub(stub: RedisStub): QueueClient {
  const client = new QueueClient({});
  (client as unknown as { redis: RedisStub }).redis = stub;
  return client;
}

function readGauge(stream: string): number | null {
  const metric = (redisStreamLength as unknown as { hashMap: Record<string, { value: number }> })
    .hashMap;
  for (const k of Object.keys(metric)) {
    if (k.includes(`stream:${stream}`)) return metric[k]!.value;
  }
  return null;
}

describe('mode 6.8 — Redis stream scraper', () => {
  beforeEach(() => {
    redisStreamLength.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sampleStreamLength updates the gauge with the XLEN value', async () => {
    const stub: RedisStub = { xlen: vi.fn().mockResolvedValue(12345) };
    const client = makeClientWithStub(stub);
    const len = await client.sampleStreamLength('vigil:test-stream-a');
    expect(len).toBe(12345);
    expect(stub.xlen).toHaveBeenCalledWith('vigil:test-stream-a');
    expect(readGauge('vigil:test-stream-a')).toBe(12345);
  });

  it('startRedisStreamScraper fires once immediately + on every tick', async () => {
    const stub: RedisStub = { xlen: vi.fn().mockResolvedValue(42) };
    const client = makeClientWithStub(stub);
    const scraper = startRedisStreamScraper(client, {
      intervalMs: 20,
      streams: ['vigil:t-b'],
    });
    try {
      // Wait for >= 3 ticks (one immediate + 2 interval).
      await sleep(70);
      expect(stub.xlen.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(readGauge('vigil:t-b')).toBe(42);
    } finally {
      scraper.stop();
    }
  });

  it('stop() halts further ticks', async () => {
    const stub: RedisStub = { xlen: vi.fn().mockResolvedValue(100) };
    const client = makeClientWithStub(stub);
    const scraper = startRedisStreamScraper(client, {
      intervalMs: 20,
      streams: ['vigil:t-c'],
    });
    await sleep(50); // ~2-3 ticks
    const callsBeforeStop = stub.xlen.mock.calls.length;
    scraper.stop();
    await sleep(100); // would be 5 more ticks if running
    const callsAfterStop = stub.xlen.mock.calls.length;
    // Allow 1 in-flight call (already started before stop). Generally
    // callsAfterStop === callsBeforeStop, but if a tick was mid-flight
    // it can be +1.
    expect(callsAfterStop - callsBeforeStop).toBeLessThanOrEqual(1);
  });

  it('xlen failures are caught + logged; scraper keeps running for other streams', async () => {
    // First stream errors; second succeeds. The scraper logs the
    // first error and continues to the second.
    const stub: RedisStub = {
      xlen: vi.fn().mockImplementation((stream: string) => {
        if (stream === 'vigil:t-d-bad') return Promise.reject(new Error('redis: down'));
        return Promise.resolve(7);
      }),
    };
    const client = makeClientWithStub(stub);
    const warn = vi.fn();
    const logger = {
      warn,
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(() => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    };
    const scraper = startRedisStreamScraper(client, {
      intervalMs: 20,
      streams: ['vigil:t-d-bad', 'vigil:t-d-good'],
      logger: logger as unknown as Parameters<typeof startRedisStreamScraper>[1]['logger'],
    });
    try {
      await sleep(50);
      // The good stream's gauge was set.
      expect(readGauge('vigil:t-d-good')).toBe(7);
      // The bad stream's failure was logged at warn.
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ stream: 'vigil:t-d-bad' }),
        'redis-stream-scrape-failed',
      );
    } finally {
      scraper.stop();
    }
  });
});
