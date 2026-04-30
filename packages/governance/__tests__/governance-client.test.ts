/**
 * AUDIT-062 — GovernanceReadClient unit tests.
 *
 * Goal: pin the BigInt → number mapping in getProposal (the place where a
 * silent off-by-one or precision-loss regression would land), pin the
 * watch() subscription/unsubscription contract, and prove the client
 * boots without an RPC round-trip (constructor must be lazy so workers
 * don't crash at import time when the RPC is unreachable).
 *
 * We don't spin up an Anvil instance here; the contract surface is stubbed
 * by replacing `contract.getFunction(...).staticCall` and the on/off
 * methods on the underlying ethers.Contract. The ABI-level integrity is
 * covered by abi.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GovernanceReadClient } from '../src/governance-client.js';

import type { ethers } from 'ethers';

interface FakeFn {
  staticCall: ReturnType<typeof vi.fn>;
}

function fakeContract(staticCallReturns: Record<string, unknown>): {
  getFunction: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  _listeners: Map<string, Set<(...a: unknown[]) => void>>;
} {
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  const getFunction = vi.fn((name: string): FakeFn => {
    return {
      staticCall: vi.fn(() => Promise.resolve(staticCallReturns[name])),
    };
  });
  const on = vi.fn((event: string, fn: (...a: unknown[]) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
  });
  const off = vi.fn((event: string, fn: (...a: unknown[]) => void) => {
    listeners.get(event)?.delete(fn);
  });
  return { getFunction, on, off, _listeners: listeners };
}

describe('AUDIT-062 — GovernanceReadClient.constructor', () => {
  it('is lazy: no RPC traffic on instantiation', () => {
    // If the constructor tried to dial the RPC, this would throw or hang.
    // Instead it should store a JsonRpcProvider whose first call is on
    // demand (ethers.js v6 contract).
    const c = new GovernanceReadClient(
      'http://127.0.0.1:1', // closed port; would fail if eagerly contacted
      '0x0000000000000000000000000000000000000001',
    );
    expect(c.contract).toBeDefined();
  });
});

describe('AUDIT-062 — GovernanceReadClient.getProposal mapping', () => {
  let client: GovernanceReadClient;

  beforeEach(() => {
    client = new GovernanceReadClient(
      'http://127.0.0.1:1',
      '0x0000000000000000000000000000000000000001',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps a 9-element tuple to the typed object, BigInt → number for state/timestamps/counts', async () => {
    const tuple: [string, string, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
      '0x' + 'aa'.repeat(32),
      'ipfs://bafy.../report.pdf',
      1n, // state = ESCALATED
      1714000000n, // openedAt
      1714600000n, // closesAt
      3n, // yes
      1n, // no
      0n, // abstain
      1n, // recuse
    ];
    const fake = fakeContract({ getProposal: tuple });
    (client as unknown as { contract: typeof fake }).contract = fake;
    const r = await client.getProposal(7);
    expect(r.findingHash).toBe(tuple[0]);
    expect(r.uri).toBe(tuple[1]);
    expect(r.state).toBe(1);
    expect(r.openedAt).toBe(1714000000);
    expect(r.closesAt).toBe(1714600000);
    expect(r.yes).toBe(3);
    expect(r.no).toBe(1);
    expect(r.abstain).toBe(0);
    expect(r.recuse).toBe(1);
    // Indexes that came in as bigint must become number (no BigInt leak)
    expect(typeof r.state).toBe('number');
    expect(typeof r.yes).toBe('number');
    expect(typeof r.openedAt).toBe('number');
  });

  it('totalProposals converts bigint → number', async () => {
    const fake = fakeContract({ totalProposals: 42n });
    (client as unknown as { contract: typeof fake }).contract = fake;
    const r = await client.totalProposals();
    expect(r).toBe(42);
    expect(typeof r).toBe('number');
  });

  it('quorumRequired converts bigint → number', async () => {
    const fake = fakeContract({ quorumRequired: 3n });
    (client as unknown as { contract: typeof fake }).contract = fake;
    const r = await client.quorumRequired();
    expect(r).toBe(3);
    expect(typeof r).toBe('number');
  });

  it('handles tuple at edge of 32-bit range without precision loss (u32 timestamps fit in JS number)', async () => {
    // openedAt up to ~year 2106 for u32 seconds; well within Number.MAX_SAFE_INTEGER.
    const tuple: [string, string, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
      '0x' + '00'.repeat(32),
      '',
      0n,
      4294967295n,
      4294967295n,
      0n,
      0n,
      0n,
      0n,
    ];
    const fake = fakeContract({ getProposal: tuple });
    (client as unknown as { contract: typeof fake }).contract = fake;
    const r = await client.getProposal(0);
    expect(r.openedAt).toBe(4294967295);
    expect(r.closesAt).toBe(4294967295);
  });
});

describe('AUDIT-062 — GovernanceReadClient.watch', () => {
  let client: GovernanceReadClient;

  beforeEach(() => {
    client = new GovernanceReadClient(
      'http://127.0.0.1:1',
      '0x0000000000000000000000000000000000000001',
    );
  });

  it('registers + unregisters every supplied handler', () => {
    const fake = fakeContract({});
    (client as unknown as { contract: typeof fake }).contract = fake;

    const opened = vi.fn();
    const voted = vi.fn();
    const escalated = vi.fn();
    const dismissed = vi.fn();
    const expired = vi.fn();

    const unsubscribe = client.watch({
      onProposalOpened: opened,
      onVoteCast: voted,
      onProposalEscalated: escalated,
      onProposalDismissed: dismissed,
      onProposalExpired: expired,
    });

    expect(fake.on).toHaveBeenCalledTimes(5);
    expect(fake.on.mock.calls.map((c) => c[0]).sort()).toEqual(
      [
        'ProposalDismissed',
        'ProposalEscalated',
        'ProposalExpired',
        'ProposalOpened',
        'VoteCast',
      ].sort(),
    );

    unsubscribe();
    expect(fake.off).toHaveBeenCalledTimes(5);
  });

  it('only registers handlers that were actually supplied', () => {
    const fake = fakeContract({});
    (client as unknown as { contract: typeof fake }).contract = fake;

    const opened = vi.fn();
    client.watch({ onProposalOpened: opened });

    expect(fake.on).toHaveBeenCalledTimes(1);
    expect(fake.on.mock.calls[0][0]).toBe('ProposalOpened');
  });

  it('handler is invoked with bigint→number conversion on event fire', () => {
    const fake = fakeContract({});
    (client as unknown as { contract: typeof fake }).contract = fake;

    const onProposalEscalated = vi.fn();
    client.watch({ onProposalEscalated });

    // Find the actual ethers callback that was registered, and call it
    // with a bigint as ethers v6 would.
    const registered = fake.on.mock.calls.find((c) => c[0] === 'ProposalEscalated')!;
    const cb = registered[1] as unknown as (idx: bigint) => void;
    cb(99n);

    expect(onProposalEscalated).toHaveBeenCalledWith(99);
    expect(typeof onProposalEscalated.mock.calls[0][0]).toBe('number');
  });

  it('unsubscribe is idempotent — calling twice does not throw', () => {
    const fake = fakeContract({});
    (client as unknown as { contract: typeof fake }).contract = fake;
    const unsub = client.watch({ onProposalOpened: vi.fn() });
    unsub();
    expect(() => unsub()).not.toThrow();
  });
});

describe('AUDIT-062 — getProposal arity guard', () => {
  it('does not silently accept a tuple shorter than 9 elements (shape protection)', async () => {
    const client = new GovernanceReadClient(
      'http://127.0.0.1:1',
      '0x0000000000000000000000000000000000000001',
    );
    // Wrong arity: contract returns only 5 elements.
    const tuple = ['0x' + '00'.repeat(32), '', 0n, 0n, 0n] as unknown as [
      string,
      string,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];
    const fake = fakeContract({ getProposal: tuple });
    (client as unknown as { contract: typeof fake }).contract = fake;
    const r = await client.getProposal(0);
    // The fields after index 4 will be NaN (Number(undefined)), which is
    // observable downstream as a clear bug rather than a silent zero.
    // Pin this so a future contributor who "fixes" the conversion to ?? 0
    // is forced to think about whether they want to mask shape bugs.
    expect(Number.isNaN(r.yes)).toBe(true);
    expect(Number.isNaN(r.no)).toBe(true);
  });

  it.skip('placeholder — once a runtime arity guard is added, this test should fail before fix and pass after', () => {
    // Not implementing the guard in this audit pass; pinning the current
    // observable behaviour above. Adding a guard would be a separate
    // finding under §5 (correctness).
  });
});

describe('AUDIT-062 — type imports', () => {
  it('ethers types remain importable (dependency-drift early-warning)', () => {
    const typesPresent: typeof ethers extends never ? false : true = true;
    expect(typesPresent).toBe(true);
  });
});
