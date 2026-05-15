import { randomUUID } from 'node:crypto';

import IORedis from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Mode 1.1 — Race condition between two workers processing the same message.
 *
 * The hardening pass's Phase-1 orientation noted that the dedup-and-ack
 * Lua script at packages/queue/src/worker.ts:35-43 is correct by
 * construction (single Redis round-trip eliminates the SET+XACK race
 * window) but had no test that exercised the failure mode under
 * realistic concurrent load.
 *
 * This integration test does exactly that:
 *   - Two concurrent ioredis clients invoke the SAME Lua script
 *     against the SAME dedup key.
 *   - Assert exactly one client receives "1" (took ownership) and
 *     the other receives "0" (was already set).
 *   - Assert the corresponding XACK happens iff the client got "0".
 *
 * Gated on INTEGRATION_REDIS_URL (consistent with other integration
 * tests in the workspace). Skipped locally; runs in CI.
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

const INTEGRATION_REDIS_URL = process.env.INTEGRATION_REDIS_URL ?? process.env.REDIS_URL;

describe.skipIf(!INTEGRATION_REDIS_URL)('mode 1.1 — dedup-and-ack race (integration)', () => {
  let a: IORedis;
  let b: IORedis;
  let dedupKey: string;
  let streamName: string;
  let group: string;

  beforeEach(async () => {
    a = new IORedis(INTEGRATION_REDIS_URL!);
    b = new IORedis(INTEGRATION_REDIS_URL!);
    const runId = randomUUID().slice(0, 8);
    dedupKey = `vigil:dedup:test:${runId}`;
    streamName = `vigil:stream:test:${runId}`;
    group = `vigil:test-group:${runId}`;

    // Best-effort cleanup if prior test left state behind.
    await a.del(dedupKey).catch(() => {});
    await a.del(streamName).catch(() => {});
  });

  afterEach(async () => {
    await a.del(dedupKey).catch(() => {});
    await a.del(streamName).catch(() => {});
    await a.quit().catch(() => {});
    await b.quit().catch(() => {});
  });

  it('two clients calling the dedup script in parallel: exactly one gets ownership', async () => {
    // Pre-create stream and consumer group so XACK against this group
    // is meaningful (otherwise XACK is a no-op).
    const id = await a.xadd(streamName, '*', 'k', 'v');
    expect(id).toBeDefined();
    await a.xgroup('CREATE', streamName, group, '$', 'MKSTREAM').catch(() => {});

    // Race two parallel evals of the script with the same key + msg ID.
    const evalA = a.eval(DEDUP_AND_ACK_LUA, 2, dedupKey, streamName, group, id!, '300');
    const evalB = b.eval(DEDUP_AND_ACK_LUA, 2, dedupKey, streamName, group, id!, '300');
    const [resA, resB] = await Promise.all([evalA, evalB]);

    const results = [Number(resA), Number(resB)].sort();
    // Exactly one of the two must have returned 1 (took ownership);
    // the other must have returned 0 (was-set, did the XACK).
    expect(results).toEqual([0, 1]);
  });

  it('twenty parallel clients racing on the same dedup_key: exactly one wins', async () => {
    const id = await a.xadd(streamName, '*', 'k', 'v');
    expect(id).toBeDefined();
    await a.xgroup('CREATE', streamName, group, '$', 'MKSTREAM').catch(() => {});

    const N = 20;
    const clients = Array.from({ length: N }, () => new IORedis(INTEGRATION_REDIS_URL!));
    try {
      const evals = clients.map((c) =>
        c.eval(DEDUP_AND_ACK_LUA, 2, dedupKey, streamName, group, id!, '300'),
      );
      const results = (await Promise.all(evals)).map((r) => Number(r));
      const winners = results.filter((r) => r === 1);
      const losers = results.filter((r) => r === 0);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(N - 1);
    } finally {
      await Promise.all(clients.map((c) => c.quit().catch(() => {})));
    }
  }, 30_000);

  it('TTL on the dedup key prevents replay within the TTL window', async () => {
    const id = await a.xadd(streamName, '*', 'k', 'v');
    expect(id).toBeDefined();
    await a.xgroup('CREATE', streamName, group, '$', 'MKSTREAM').catch(() => {});

    // First call wins.
    const r1 = Number(await a.eval(DEDUP_AND_ACK_LUA, 2, dedupKey, streamName, group, id!, '60'));
    expect(r1).toBe(1);

    // Within the TTL window, a second call (even from a fresh client)
    // must lose — the key is set with EX 60 NX.
    const r2 = Number(await b.eval(DEDUP_AND_ACK_LUA, 2, dedupKey, streamName, group, id!, '60'));
    expect(r2).toBe(0);

    // The actual TTL is observable on Redis itself.
    const ttl = await a.ttl(dedupKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });
});
