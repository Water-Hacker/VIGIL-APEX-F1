/**
 * Tier-49 audit closure — parse-failed envelopes must ACK.
 *
 * Pre-fix, `WorkerBase.process()` deadlettered parse-failed messages
 * via `deadLetter()` (publish-only, no XACK). The message stayed in
 * the consumer-group's pending list, got reclaimed via XAUTOCLAIM
 * every `idleReclaimMs` (5 min default), failed to parse again, wrote
 * ANOTHER DLQ row, and repeated indefinitely. The DLQ accumulated a
 * duplicate row for every malformed envelope at one row per 5 minutes
 * forever — silent quota burn + alert noise.
 *
 * Post-fix, the parse-fail path uses `deadLetterAndAck` (pipeline of
 * XADD to DLQ + XACK on the originating stream). The DLQ row is
 * canonical and the pending-list cleanup is terminal.
 *
 * Tests below use a Redis stub that records pipeline calls so we can
 * assert exactly one XACK happens per parse-failed message.
 */
import { Time } from '@vigil/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { WorkerBase, type WorkerBaseConfig } from '../src/worker.js';

class FakeClock implements Time.Clock {
  private current: number;
  constructor(start: number) {
    this.current = start;
  }
  now(): Time.EpochMs {
    return this.current as unknown as Time.EpochMs;
  }
  isoNow(): Time.IsoInstant {
    return new Date(this.current).toISOString() as unknown as Time.IsoInstant;
  }
}

interface PipelineCall {
  ops: Array<{ cmd: string; args: unknown[] }>;
}

/** Stub QueueClient whose redis.pipeline() records every chained call. */
function fakeClient(): {
  client: WorkerBaseConfig<{ x: number }>['client'];
  pipelines: PipelineCall[];
  acks: Array<{ stream: string; group: string; id: string }>;
  publishes: Array<{ stream: string; body: string }>;
} {
  const pipelines: PipelineCall[] = [];
  const acks: Array<{ stream: string; group: string; id: string }> = [];
  const publishes: Array<{ stream: string; body: string }> = [];

  const mkPipeline = (): {
    ops: Array<{ cmd: string; args: unknown[] }>;
    xadd: (...args: unknown[]) => unknown;
    xack: (...args: unknown[]) => unknown;
    exec: () => Promise<unknown>;
  } => {
    const call: PipelineCall = { ops: [] };
    pipelines.push(call);
    const chain = {
      ops: call.ops,
      xadd: (...args: unknown[]) => {
        call.ops.push({ cmd: 'xadd', args });
        if (args[0] === 'vigil:dead-letter') {
          publishes.push({ stream: 'vigil:dead-letter', body: String(args[3]) });
        }
        return chain;
      },
      xack: (...args: unknown[]) => {
        call.ops.push({ cmd: 'xack', args });
        acks.push({
          stream: String(args[0]),
          group: String(args[1]),
          id: String(args[2]),
        });
        return chain;
      },
      exec: async () => undefined,
    };
    return chain;
  };

  return {
    client: {
      redis: {
        pipeline: vi.fn(mkPipeline),
        eval: vi.fn(),
        xack: vi.fn(async (...args: unknown[]) => {
          acks.push({
            stream: String(args[0]),
            group: String(args[1]),
            id: String(args[2]),
          });
          return 1;
        }),
        del: vi.fn(),
      },
      publish: vi.fn(async (stream: string, env: Record<string, unknown>) => {
        publishes.push({ stream, body: JSON.stringify(env) });
        return '0-0';
      }),
    } as unknown as WorkerBaseConfig<{ x: number }>['client'],
    pipelines,
    acks,
    publishes,
  };
}

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child(): typeof silentLogger {
    return silentLogger;
  },
} as never;

class StubWorker extends WorkerBase<{ x: number }> {
  protected async handle(): Promise<{ kind: 'ack' }> {
    return { kind: 'ack' };
  }
  // Expose the private process method so the test can drive it without
  // standing up the full loopReadGroup.
  async invokeProcess(redisId: string, body: string): Promise<void> {
    await (this as unknown as { process: (id: string, b: string) => Promise<void> }).process(
      redisId,
      body,
    );
  }
}

function mkWorker(client: WorkerBaseConfig<{ x: number }>['client']): StubWorker {
  return new StubWorker({
    name: 'test-worker',
    stream: 'vigil:test',
    schema: z.object({ x: z.number() }) as never,
    client,
    logger: silentLogger,
    clock: new FakeClock(1_700_000_000_000),
    // Retry budget interacts with retry path, not parse-fail path —
    // disable to keep the test focused.
    retryBudget: { enabled: false },
  });
}

describe('Tier-49 — parse-failed envelopes XACK the originating stream', () => {
  it('invalid JSON body: pipelines both XADD (DLQ) and XACK (orig)', async () => {
    const { client, pipelines, acks, publishes } = fakeClient();
    const worker = mkWorker(client);
    await worker.invokeProcess('1700000000000-0', '{not valid json');

    // Exactly one pipeline call.
    expect(pipelines).toHaveLength(1);
    const ops = pipelines[0]!.ops;
    // Ordered XADD then XACK.
    expect(ops.map((o) => o.cmd)).toEqual(['xadd', 'xack']);
    // The XACK targets the originating stream + the worker's group.
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({
      stream: 'vigil:test',
      id: '1700000000000-0',
    });
    expect(acks[0]!.group).toMatch(/test-worker/);
    // The DLQ row carries the parse-failure reason for forensic audit.
    expect(publishes).toHaveLength(1);
    expect(publishes[0]!.stream).toBe('vigil:dead-letter');
    expect(publishes[0]!.body).toContain('envelope-parse-failed');
  });

  it('Zod-rejected payload: same pipeline ordering, ACK still issued', async () => {
    const { client, pipelines, acks } = fakeClient();
    const worker = mkWorker(client);
    // Valid JSON but payload doesn't match z.object({ x: z.number() }).
    const body = JSON.stringify({
      id: 'evt-1',
      dedup_key: 'd-1',
      correlation_id: 'c-1',
      producer: 'upstream',
      produced_at: '2026-01-01T00:00:00Z',
      schema_version: 1,
      payload: { x: 'not-a-number' },
    });
    await worker.invokeProcess('1700000000001-0', body);

    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]!.ops.map((o) => o.cmd)).toEqual(['xadd', 'xack']);
    expect(acks).toHaveLength(1);
    expect(acks[0]!.id).toBe('1700000000001-0');
  });

  it('does NOT call the non-ACKing publish() path (the dead helper is gone)', async () => {
    const { client, publishes } = fakeClient();
    const worker = mkWorker(client);
    await worker.invokeProcess('1700000000002-0', '{not valid json');
    // All DLQ writes must come via the pipeline (xadd directly on redis,
    // not via client.publish()). publishes captures BOTH paths; we
    // verify the DLQ entry exists but no entries came via publish() —
    // the publish() spy records to the SAME list, but our mkPipeline
    // pushes via xadd directly, so we check via the recorded shape.
    // Specifically: client.publish() spy should NOT have been called.
    expect((client.publish as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(
      0,
    );
    // But the DLQ should still have received the row (via pipeline xadd).
    const dlqRows = publishes.filter((p) => p.stream === 'vigil:dead-letter');
    expect(dlqRows).toHaveLength(1);
  });
});
