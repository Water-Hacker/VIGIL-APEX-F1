/**
 * Tier-21 audit closure — WorkerBase.instanceId no longer uses Math.random.
 *
 * Pre-T21: `Math.random().toString(36).slice(2, 8)` produced a 6-char
 * base36 suffix. HARDEN-#7 forbids Math.random for any operation that
 * could be measured. The consumer-group name is derived from this id,
 * and collision corrupts XAUTOCLAIM accounting (two workers thinking
 * they own the same pending redisId).
 *
 * Post-T21: `crypto.randomBytes(3).toString('hex')` — 6 hex chars,
 * 16.7M distinct values, cryptographically collision-resistant.
 *
 * These tests pin the shape (6 hex chars) and assert no Math.random
 * fingerprint (base36 alphabet with letters past 'f').
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { consumerName } from '../src/streams.js';
import { WorkerBase, type WorkerBaseConfig } from '../src/worker.js';

class StubWorker extends WorkerBase<{ x: number }> {
  getInstanceId(): string {
    return (this as unknown as { instanceId: string }).instanceId;
  }
  protected async handle(): Promise<{ kind: 'ack' }> {
    return { kind: 'ack' };
  }
}

function makeWorker(): StubWorker {
  return new StubWorker({
    name: 'test-worker',
    stream: 'vigil:test',
    schema: z.object({ x: z.number() }) as never,
    client: {} as unknown as WorkerBaseConfig<{ x: number }>['client'],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      silent: vi.fn(),
      level: 'info',
      child: vi.fn(),
    } as never,
    concurrency: 4,
    retryBudget: { enabled: false },
  });
}

describe('WorkerBase.instanceId — Tier-21 crypto.randomBytes suffix', () => {
  it('produces a `<hostname>-<pid>-<6 hex chars>` shape', () => {
    const w = makeWorker();
    const id = w.getInstanceId();
    // Three segments: hostname, pid, hex suffix
    const parts = id.split('-');
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const suffix = parts.at(-1)!;
    expect(suffix).toMatch(/^[0-9a-f]{6}$/);
  });

  it('suffix is hex-only — no Math.random base36 letters g..z', () => {
    // Run several times — across many instances the probability of
    // NEVER seeing a g..z letter is vanishing IF base36, but always
    // 1 if hex-only. 30 instances * 6 chars = 180 char samples.
    for (let i = 0; i < 30; i++) {
      const w = makeWorker();
      const id = w.getInstanceId();
      const suffix = id.split('-').at(-1)!;
      expect(suffix).toMatch(/^[0-9a-f]{6}$/);
      expect(suffix).not.toMatch(/[g-z]/);
    }
  });

  it('two workers produce distinct ids (collision probability tiny)', () => {
    const w1 = makeWorker();
    const w2 = makeWorker();
    expect(w1.getInstanceId()).not.toBe(w2.getInstanceId());
  });

  it('consumerName combines worker + instance — distinct for distinct instances', () => {
    const w1 = makeWorker();
    const w2 = makeWorker();
    const c1 = consumerName('test-worker', w1.getInstanceId());
    const c2 = consumerName('test-worker', w2.getInstanceId());
    expect(c1).not.toBe(c2);
  });
});
