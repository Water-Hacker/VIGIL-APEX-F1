/**
 * Tier-53 audit closure — high-sig batch bail-out on consecutive failures.
 *
 * Pre-fix, `processHighSigBatch` continued through all 50 events even
 * when every commit failed (Polygon RPC outage, signer down). With 50
 * events × ~5s each, one batch could spend ~4 minutes on a doomed
 * pass. The driver loop's LoopBackoff was then RESET on every partial
 * success (zero successes here, but the absence of a thrown error
 * meant the loop's outer catch never fired), defeating backoff.
 *
 * Post-fix, the batch bails out after MAX_CONSECUTIVE_BATCH_FAILURES
 * (5) and returns a structured `HighSigBatchResult { succeeded,
 * failed, attempted, bailedOut }`. The driver loop routes on the
 * result shape so backoff fires correctly.
 */
import { describe, expect, it, vi } from 'vitest';

import { processHighSigBatch } from '../src/high-sig-loop.js';

const SILENT_LOGGER = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child(): typeof SILENT_LOGGER {
    return SILENT_LOGGER;
  },
} as never;

function makeEvents(n: number): Array<{
  event_id: string;
  record_hash: string;
  timestamp_utc: Date;
  event_type: string;
  high_significance: true;
  chain_anchor_tx: null;
}> {
  return Array.from({ length: n }, (_, i) => ({
    event_id: `evt-${String(i).padStart(36, '0')}`,
    record_hash: String(i).padStart(64, 'a'),
    timestamp_utc: new Date(1_730_000_000_000 + i * 1000),
    event_type: 'vote.cast',
    high_significance: true as const,
    chain_anchor_tx: null,
  }));
}

function makeDeps(events: ReturnType<typeof makeEvents>, alwaysFail: boolean) {
  const anchor = {
    commit: vi.fn(async (_f: number, _t: number, h: string) => {
      if (alwaysFail) throw new Error('rpc-outage');
      return `0x${h.slice(0, 64).padEnd(64, '0')}`;
    }),
  };
  const anchored = new Set<string>();
  const userActionRepo = {
    listPendingHighSig: vi.fn(async () => events.filter((e) => !anchored.has(e.event_id))),
    setAnchorTx: vi.fn(async (id: string, _t: string) => {
      anchored.add(id);
    }),
  };
  const publicAnchorRepo = {
    record: vi.fn(async (_row: Record<string, unknown>) => undefined),
  };
  return {
    deps: {
      anchor: anchor as never,
      userActionRepo: userActionRepo as never,
      publicAnchorRepo: publicAnchorRepo as never,
      logger: SILENT_LOGGER,
    },
    spies: { anchor, userActionRepo, publicAnchorRepo },
  };
}

describe('Tier-53 — processHighSigBatch bail-out + structured result', () => {
  it('bails out after MAX_CONSECUTIVE_BATCH_FAILURES (5) consecutive errors', async () => {
    const events = makeEvents(50);
    const { deps, spies } = makeDeps(events, /*alwaysFail*/ true);

    const r = await processHighSigBatch(deps);

    // 5 attempts ALL failed; loop bailed before attempting #6.
    expect(r.succeeded).toBe(0);
    expect(r.failed).toBe(5);
    expect(r.attempted).toBe(5);
    expect(r.bailedOut).toBe(true);
    expect(spies.anchor.commit).toHaveBeenCalledTimes(5);
    expect(spies.userActionRepo.setAnchorTx).not.toHaveBeenCalled();
  });

  it('does NOT bail when failures are interspersed (counter resets on success)', async () => {
    const events = makeEvents(10);
    let i = 0;
    const anchor = {
      commit: vi.fn(async (_f: number, _t: number, h: string) => {
        // Pattern: fail-fail-OK-fail-fail-OK-... — never hits 5 in a row.
        const fail = i % 3 < 2;
        i++;
        if (fail) throw new Error('intermittent');
        return `0x${h.slice(0, 64).padEnd(64, '0')}`;
      }),
    };
    const anchored = new Set<string>();
    const userActionRepo = {
      listPendingHighSig: vi.fn(async () => events.filter((e) => !anchored.has(e.event_id))),
      setAnchorTx: vi.fn(async (id: string, _t: string) => {
        anchored.add(id);
      }),
    };
    const publicAnchorRepo = {
      record: vi.fn(async (_row: Record<string, unknown>) => undefined),
    };
    const r = await processHighSigBatch({
      anchor: anchor as never,
      userActionRepo: userActionRepo as never,
      publicAnchorRepo: publicAnchorRepo as never,
      logger: SILENT_LOGGER,
    });
    expect(r.bailedOut).toBe(false);
    expect(r.attempted).toBe(10);
    expect(r.failed).toBeGreaterThan(0);
    expect(r.succeeded).toBeGreaterThan(0);
  });

  it('returns succeeded=attempted=0 on an empty pending queue', async () => {
    const { deps } = makeDeps([], /*alwaysFail*/ true);
    const r = await processHighSigBatch(deps);
    expect(r).toEqual({ succeeded: 0, failed: 0, attempted: 0, bailedOut: false });
  });
});
