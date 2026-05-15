import { STREAMS, type QueueClient } from '@vigil/queue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { republishToFabricBridge } from '../src/republish.js';

/**
 * Mode 3.2 — Silent drop on witness failure.
 *
 * The contract this test pins down:
 *   - Postgres write succeeds (the row is in `audit.actions`).
 *   - Fabric submit fails asynchronously (the row is absent from
 *     `audit.fabric_witness`).
 *   - The reconciliation worker detects the gap and calls
 *     republishToFabricBridge.
 *   - republishToFabricBridge publishes a recovery envelope to
 *     STREAMS.AUDIT_PUBLISH with a `reconcil:<seq>` dedup_key so the
 *     fabric-bridge can re-attempt the Fabric submission without
 *     producing a duplicate audit row.
 *   - Critically: the audit.actions row is NEVER deleted or mutated
 *     by this path. Recovery happens by re-trying the Fabric write,
 *     not by re-creating the original audit row.
 *
 * The test exercises the recovery path with a fake QueueClient that
 * captures every publish. Postgres state is implicit (the gaps list
 * is what the reconciliation has already computed).
 */

interface QueueStub {
  publish: ReturnType<typeof vi.fn>;
  publishedEnvelopes: Array<{ stream: string; envelope: unknown }>;
}

function makeQueueStub(failOnSeqs: Set<string> = new Set()): QueueStub {
  const publishedEnvelopes: Array<{ stream: string; envelope: unknown }> = [];
  const publish = vi.fn((stream: string, envelope: { payload?: { seq?: string } }) => {
    const seq = envelope.payload?.seq;
    if (seq && failOnSeqs.has(seq)) {
      return Promise.reject(new Error(`stub-publish-failed for seq ${seq}`));
    }
    publishedEnvelopes.push({ stream, envelope });
    return Promise.resolve('1-0' as string);
  });
  return { publish, publishedEnvelopes } as QueueStub;
}

interface LoggerStub {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
}

function makeLoggerStub(): LoggerStub {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { ...stub, child: vi.fn(() => stub) } as LoggerStub;
}

describe('mode 3.2 — republishToFabricBridge recovery (silent-drop closure)', () => {
  let queue: QueueStub;
  let logger: LoggerStub;

  beforeEach(() => {
    queue = makeQueueStub();
    logger = makeLoggerStub();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes a recovery envelope for each gap', async () => {
    const gaps = [
      { seq: '5', body_hash: 'aa'.repeat(32) },
      { seq: '6', body_hash: 'bb'.repeat(32) },
      { seq: '7', body_hash: 'cc'.repeat(32) },
    ];
    const result = await republishToFabricBridge(
      queue as unknown as QueueClient,
      gaps,
      100,
      logger as unknown as Parameters<typeof republishToFabricBridge>[3],
    );

    expect(result).toEqual({ published: 3, failed: 0 });
    expect(queue.publish).toHaveBeenCalledTimes(3);
    expect(queue.publishedEnvelopes).toHaveLength(3);

    // Each published envelope targets AUDIT_PUBLISH and carries the
    // seq + body_hash of the gap.
    for (let i = 0; i < gaps.length; i++) {
      const e = queue.publishedEnvelopes[i]!;
      expect(e.stream).toBe(STREAMS.AUDIT_PUBLISH);
      const payload = (e.envelope as { payload: { seq: string; body_hash: string } }).payload;
      expect(payload.seq).toBe(gaps[i]!.seq);
      expect(payload.body_hash).toBe(gaps[i]!.body_hash);
    }
  });

  it('dedup_key carries the `reconcil:` prefix so the fabric-bridge keeps the original audit row', async () => {
    const gaps = [{ seq: '42', body_hash: 'dead'.repeat(16) }];
    await republishToFabricBridge(
      queue as unknown as QueueClient,
      gaps,
      100,
      logger as unknown as Parameters<typeof republishToFabricBridge>[3],
    );

    const env = queue.publishedEnvelopes[0]!.envelope as { dedup_key: string };
    expect(env.dedup_key).toBe('reconcil:42');
  });

  it('respects maxPerTick — caps publishes even when there are many gaps', async () => {
    const gaps = Array.from({ length: 50 }, (_, i) => ({
      seq: String(i + 1),
      body_hash: i.toString(16).padStart(64, '0'),
    }));

    const result = await republishToFabricBridge(
      queue as unknown as QueueClient,
      gaps,
      10,
      logger as unknown as Parameters<typeof republishToFabricBridge>[3],
    );

    expect(result.published).toBe(10);
    expect(result.failed).toBe(0);
    expect(queue.publish).toHaveBeenCalledTimes(10);
  });

  it(
    'continues past per-envelope publish failures and reports the failed count — ' +
      'the audit.actions row is preserved so the next tick retries',
    async () => {
      // Simulate the queue rejecting seq=2 (e.g. transient Redis hiccup).
      // The reconciliation must publish seqs 1, 3, 4 successfully and
      // log the failure for seq 2 — NEVER throw, NEVER drop the
      // audit.actions row implicitly. The next tick will see seq 2
      // still missing from Fabric and retry.
      queue = makeQueueStub(new Set(['2']));
      const gaps = [
        { seq: '1', body_hash: 'aa'.repeat(32) },
        { seq: '2', body_hash: 'bb'.repeat(32) },
        { seq: '3', body_hash: 'cc'.repeat(32) },
        { seq: '4', body_hash: 'dd'.repeat(32) },
      ];

      const result = await republishToFabricBridge(
        queue as unknown as QueueClient,
        gaps,
        100,
        logger as unknown as Parameters<typeof republishToFabricBridge>[3],
      );

      expect(result).toEqual({ published: 3, failed: 1 });
      // 4 attempts; 3 successes captured.
      expect(
        queue.publishedEnvelopes.map(
          (e) => (e.envelope as { payload: { seq: string } }).payload.seq,
        ),
      ).toEqual(['1', '3', '4']);
      // The failure was logged, not swallowed silently.
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ seq: '2' }),
        'reconcil-republish-failed',
      );
    },
  );

  it('empty gaps list is a no-op (idempotent clean-state tick)', async () => {
    const result = await republishToFabricBridge(
      queue as unknown as QueueClient,
      [],
      100,
      logger as unknown as Parameters<typeof republishToFabricBridge>[3],
    );
    expect(result).toEqual({ published: 0, failed: 0 });
    expect(queue.publish).not.toHaveBeenCalled();
  });
});
