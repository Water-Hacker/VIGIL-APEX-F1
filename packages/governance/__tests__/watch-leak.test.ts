import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GovernanceReadClient } from '../src/governance-client.js';

/**
 * Mode 1.9 — Memory leak from forgotten references.
 *
 * Existing tests at __tests__/governance-client.test.ts cover the
 * registration/unregistration contract: watch() returns an unsubscribe
 * function that calls contract.off() the right number of times.
 *
 * What those tests DON'T verify is the actual leak-mode invariant:
 * after `unsubscribe()`, subsequent events MUST NOT reach the handler.
 * If the underlying contract.off() implementation were buggy or
 * watch() captured the handler in a side-channel that survives
 * unsubscribe, the listener would leak silently. The leak grows
 * unbounded over the worker's lifetime — each call to `watch()` +
 * implicit re-watch (e.g. on reconnect) leaves a dangling handler.
 *
 * These tests prove the invariant by simulating event delivery via the
 * mock contract and asserting handler invocation count before and
 * after unsubscribe.
 */

interface FakeContract {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  // Per-event handler map kept on the fake so we can simulate event
  // dispatch like ethers' EventEmitter would.
  handlers: Map<string, Set<(...a: unknown[]) => void>>;
  emit: (event: string, ...args: unknown[]) => void;
  listenerCount: (event: string) => number;
}

function fakeContract(): FakeContract {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const ensure = (e: string): Set<(...a: unknown[]) => void> => {
    let s = handlers.get(e);
    if (!s) {
      s = new Set();
      handlers.set(e, s);
    }
    return s;
  };
  const fc: FakeContract = {
    handlers,
    on: vi.fn((event: string, handler: (...a: unknown[]) => void) => {
      ensure(event).add(handler);
      return fc; // ethers contract chains
    }),
    off: vi.fn((event: string, handler: (...a: unknown[]) => void) => {
      handlers.get(event)?.delete(handler);
      return fc;
    }),
    emit: (event: string, ...args: unknown[]) => {
      const set = handlers.get(event);
      if (!set) return;
      for (const h of set) h(...args);
    },
    listenerCount: (event: string) => handlers.get(event)?.size ?? 0,
  };
  return fc;
}

describe('mode 1.9 — watch() listener leak regression', () => {
  let client: GovernanceReadClient;

  beforeEach(() => {
    client = new GovernanceReadClient(
      'http://127.0.0.1:1',
      '0x0000000000000000000000000000000000000001',
    );
  });

  it('handler is called BEFORE unsubscribe and NOT called AFTER', () => {
    const fake = fakeContract();
    (client as unknown as { contract: FakeContract }).contract = fake;

    const onProposalEscalated = vi.fn();
    const unsubscribe = client.watch({ onProposalEscalated });

    // Fire — handler is called once.
    fake.emit('ProposalEscalated', 7n);
    expect(onProposalEscalated).toHaveBeenCalledTimes(1);
    expect(onProposalEscalated).toHaveBeenLastCalledWith(7);

    // Unsubscribe — handler is removed from the listener set.
    unsubscribe();
    expect(fake.listenerCount('ProposalEscalated')).toBe(0);

    // Fire again — handler MUST NOT be called.
    fake.emit('ProposalEscalated', 99n);
    expect(onProposalEscalated).toHaveBeenCalledTimes(1); // unchanged
  });

  it('100 watch/unsubscribe cycles do not accumulate listeners', () => {
    const fake = fakeContract();
    (client as unknown as { contract: FakeContract }).contract = fake;

    for (let i = 0; i < 100; i++) {
      const unsub = client.watch({
        onProposalOpened: vi.fn(),
        onVoteCast: vi.fn(),
        onProposalEscalated: vi.fn(),
        onProposalDismissed: vi.fn(),
        onProposalExpired: vi.fn(),
      });
      unsub();
    }

    // Every event must be back to zero listeners after the cycles.
    expect(fake.listenerCount('ProposalOpened')).toBe(0);
    expect(fake.listenerCount('VoteCast')).toBe(0);
    expect(fake.listenerCount('ProposalEscalated')).toBe(0);
    expect(fake.listenerCount('ProposalDismissed')).toBe(0);
    expect(fake.listenerCount('ProposalExpired')).toBe(0);
  });

  it('watch without unsubscribe leaks (proves the test would catch a leak)', () => {
    // This test is the INVERSE proof: it shows that if the caller
    // forgets to call unsubscribe, listeners DO accumulate. This is
    // the failure mode mode 1.9 names — the test exists so that the
    // codebase explicitly documents the cost of forgetting.
    const fake = fakeContract();
    (client as unknown as { contract: FakeContract }).contract = fake;

    for (let i = 0; i < 10; i++) {
      client.watch({ onProposalEscalated: vi.fn() });
      // Note: NO unsubscribe call.
    }
    expect(fake.listenerCount('ProposalEscalated')).toBe(10);

    // The takeaway for callers: long-lived workers MUST call the
    // returned unsubscribe function on shutdown. This is documented
    // in the watch() JSDoc.
  });

  it('mixed: subscribe twice with different handler sets, unsubscribe one, the other still fires', () => {
    const fake = fakeContract();
    (client as unknown as { contract: FakeContract }).contract = fake;

    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const unsubA = client.watch({ onProposalOpened: handlerA });
    client.watch({ onProposalOpened: handlerB });

    fake.emit('ProposalOpened', 1n, 'h', 'p', 'u');
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);

    unsubA();
    fake.emit('ProposalOpened', 2n, 'h', 'p', 'u');
    expect(handlerA).toHaveBeenCalledTimes(1); // unchanged
    expect(handlerB).toHaveBeenCalledTimes(2); // received the second
  });
});
