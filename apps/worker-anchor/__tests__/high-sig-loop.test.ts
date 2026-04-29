import { describe, expect, it, vi } from 'vitest';

import { processHighSigBatch } from '../src/high-sig-loop.js';

/**
 * DECISION-012 — fast-lane Polygon anchor flow.
 *
 * `processHighSigBatch` drains the pending high-significance queue once.
 * For each event it:
 *   1. calls anchor.commit(seq, seq, recordHash)
 *   2. records (event_id, polygon_tx_hash) in audit.public_anchor with
 *      is_individual=true
 *   3. sets chain_anchor_tx on the user_action_event row
 *
 * A second tick over the same (now-anchored) events must be a no-op.
 */

const FAKE_LOGGER = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => FAKE_LOGGER,
} as never;

function makeEvent(eventId: string, recordHash: string, ts: string) {
  return {
    event_id: eventId,
    record_hash: recordHash,
    timestamp_utc: new Date(ts),
    event_type: 'vote.cast',
    high_significance: true,
    chain_anchor_tx: null,
  };
}

function makeDeps(initialPending: ReturnType<typeof makeEvent>[]) {
  // The anchor's commit returns a deterministic stub txHash.
  const anchor = {
    commit: vi.fn(async (_from: number, _to: number, recordHash: string) => {
      return `0x${recordHash.slice(0, 64).padEnd(64, '0')}`;
    }),
  };

  // Mutable fake of the user-action repo. Once setAnchorTx fires, the row
  // disappears from the next listPendingHighSig() result — that's the
  // contract that makes a second tick idempotent.
  const queue = [...initialPending];
  const anchored = new Set<string>();
  const userActionRepo = {
    listPendingHighSig: vi.fn(async () => queue.filter((e) => !anchored.has(e.event_id))),
    setAnchorTx: vi.fn(async (eventId: string, _txHash: string) => {
      anchored.add(eventId);
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
      logger: FAKE_LOGGER,
    },
    spies: { anchor, userActionRepo, publicAnchorRepo },
  };
}

describe('processHighSigBatch (DECISION-012 fast-lane)', () => {
  it('anchors each pending event exactly once and records (event_id, polygon_tx_hash)', async () => {
    const events = [
      makeEvent('11111111-1111-1111-1111-111111111111', 'a'.repeat(64), '2026-04-29T12:00:00Z'),
      makeEvent('22222222-2222-2222-2222-222222222222', 'b'.repeat(64), '2026-04-29T12:00:30Z'),
      makeEvent('33333333-3333-3333-3333-333333333333', 'c'.repeat(64), '2026-04-29T12:01:00Z'),
    ];
    const { deps, spies } = makeDeps(events);

    const count = await processHighSigBatch(deps);

    expect(count).toBe(3);
    expect(spies.anchor.commit).toHaveBeenCalledTimes(3);
    expect(spies.publicAnchorRepo.record).toHaveBeenCalledTimes(3);
    expect(spies.userActionRepo.setAnchorTx).toHaveBeenCalledTimes(3);

    // Each public_anchor row carries is_individual=true, the event id, and the tx hash.
    for (let i = 0; i < 3; i++) {
      const row = spies.publicAnchorRepo.record.mock.calls[i]![0] as Record<string, unknown>;
      expect(row.event_id).toBe(events[i]!.event_id);
      expect(row.is_individual).toBe(true);
      expect(typeof row.polygon_tx_hash).toBe('string');
      expect((row.polygon_tx_hash as string).startsWith('0x')).toBe(true);
    }

    // The anchor was called with seq derived from each event's ts (in seconds).
    const expectedSeqs = events.map((e) => Math.floor(e.timestamp_utc.getTime() / 1000));
    for (let i = 0; i < 3; i++) {
      const args = spies.anchor.commit.mock.calls[i]!;
      expect(args[0]).toBe(expectedSeqs[i]);
      expect(args[1]).toBe(expectedSeqs[i]);
      expect(args[2]).toBe(events[i]!.record_hash);
    }
  });

  it('is a no-op on a second tick once events are anchored', async () => {
    const events = [
      makeEvent('44444444-4444-4444-4444-444444444444', 'd'.repeat(64), '2026-04-29T13:00:00Z'),
    ];
    const { deps, spies } = makeDeps(events);

    const first = await processHighSigBatch(deps);
    expect(first).toBe(1);

    const second = await processHighSigBatch(deps);
    expect(second).toBe(0);
    // anchor.commit not invoked again
    expect(spies.anchor.commit).toHaveBeenCalledTimes(1);
    expect(spies.publicAnchorRepo.record).toHaveBeenCalledTimes(1);
    expect(spies.userActionRepo.setAnchorTx).toHaveBeenCalledTimes(1);
  });

  it('a per-event anchor failure does not abort the rest of the batch', async () => {
    const events = [
      makeEvent('55555555-5555-5555-5555-555555555555', 'e'.repeat(64), '2026-04-29T14:00:00Z'),
      makeEvent('66666666-6666-6666-6666-666666666666', 'f'.repeat(64), '2026-04-29T14:00:30Z'),
    ];
    const { deps, spies } = makeDeps(events);
    let calls = 0;
    spies.anchor.commit.mockImplementation(async (_f: number, _t: number, h: string) => {
      calls += 1;
      if (calls === 1) throw new Error('rpc-down');
      return `0x${h.slice(0, 64).padEnd(64, '0')}`;
    });

    const count = await processHighSigBatch(deps);

    expect(count).toBe(1);
    expect(spies.publicAnchorRepo.record).toHaveBeenCalledTimes(1);
    expect(spies.userActionRepo.setAnchorTx).toHaveBeenCalledTimes(1);
    // Failure was logged
    expect((deps.logger as { error: ReturnType<typeof vi.fn> }).error).toHaveBeenCalled();
  });
});
