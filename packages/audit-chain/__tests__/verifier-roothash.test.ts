/**
 * Tier-0 audit — LedgerVerifier rootHash comparison.
 *
 * Pre-fix: verifyLatest() called chain.verify(fromSeq, toSeq) for internal
 * consistency of the local rows but NEVER compared the local computed
 * tail hash against commit.rootHash from Polygon. An attacker who could
 * rewrite local rows (consistently re-linking every body_hash and
 * prev_hash downstream) would pass chain.verify while the on-chain
 * anchor proved divergence — but the verifier didn't look. The whole
 * point of the public anchor was defeated.
 *
 * Post-fix: after chain.verify, we read body_hash at toSeq and compare
 * to commit.rootHash. Mismatch → HashChainBrokenError.
 *
 * These tests mock both HashChain and PolygonAnchor so we don't need
 * Postgres or a Polygon node.
 */

import { describe, expect, it, vi } from 'vitest';

import { LedgerVerifier } from '../src/verifier.js';

import type { HashChain } from '../src/hash-chain.js';
import type { PolygonAnchor } from '../src/polygon-anchor.js';

interface FakeCommit {
  fromSeq: number;
  toSeq: number;
  rootHash: string;
  committer: string;
  timestamp: number;
}

function makeFakeChain(opts: {
  verify?: (from: number, to: number) => Promise<number>;
  bodyHashAt?: (seq: number) => Promise<string | null>;
}): HashChain {
  return {
    verify: opts.verify ?? (async (from, to) => to - from + 1),
    bodyHashAt: opts.bodyHashAt ?? (async () => null),
  } as unknown as HashChain;
}

function makeFakeAnchor(commits: FakeCommit[]): PolygonAnchor {
  return {
    totalCommitments: async () => commits.length,
    getCommitment: async (i: number) => commits[i]!,
  } as unknown as PolygonAnchor;
}

const ROOT_OK = 'a'.repeat(64);
const ROOT_TAMPERED = 'b'.repeat(64);

describe('LedgerVerifier — tier-0 audit closure: anchored rootHash comparison', () => {
  it('verifyLatest passes when local tail body_hash matches commit.rootHash', async () => {
    const chain = makeFakeChain({
      verify: async (from, to) => to - from + 1,
      bodyHashAt: async (seq) => {
        if (seq === 100) return ROOT_OK;
        return null;
      },
    });
    const anchor = makeFakeAnchor([
      {
        fromSeq: 1,
        toSeq: 100,
        rootHash: ROOT_OK,
        committer: '0xabc',
        timestamp: 1_700_000_000,
      },
    ]);
    const verifier = new LedgerVerifier(chain, anchor);
    const result = await verifier.verifyLatest();
    expect(result).toEqual({ verified: 100, commitmentsChecked: 1 });
  });

  it('verifyLatest throws when local tail body_hash diverges from anchored rootHash', async () => {
    // The local rows internally verify (chain.verify returns count) but
    // the body_hash at toSeq is DIFFERENT from what was anchored to
    // Polygon. This is the exact attack the tier-0 audit closes:
    // sophisticated local-rewrite that fools chain.verify but cannot
    // touch the on-chain anchor.
    const chain = makeFakeChain({
      verify: async (from, to) => to - from + 1,
      bodyHashAt: async () => ROOT_TAMPERED,
    });
    const anchor = makeFakeAnchor([
      {
        fromSeq: 1,
        toSeq: 100,
        rootHash: ROOT_OK,
        committer: '0xabc',
        timestamp: 1_700_000_000,
      },
    ]);
    const verifier = new LedgerVerifier(chain, anchor);
    await expect(verifier.verifyLatest()).rejects.toThrow(
      /HASH_CHAIN_BREAK|HashChainBrokenError|hash chain/i,
    );
  });

  it('verifyLatest throws when local tail seq is missing entirely (deleted row)', async () => {
    const chain = makeFakeChain({
      verify: async (from, to) => to - from + 1,
      bodyHashAt: async () => null,
    });
    const anchor = makeFakeAnchor([
      {
        fromSeq: 1,
        toSeq: 100,
        rootHash: ROOT_OK,
        committer: '0xabc',
        timestamp: 1_700_000_000,
      },
    ]);
    const verifier = new LedgerVerifier(chain, anchor);
    await expect(verifier.verifyLatest()).rejects.toThrow();
  });

  it('verifyLatest is case-insensitive on the rootHash hex comparison', async () => {
    // commit.rootHash often arrives as 0x-prefixed UPPER from the chain
    // ABI decoder; local body_hash is stored as lowercase hex. The
    // comparison must normalise.
    const chain = makeFakeChain({
      verify: async (from, to) => to - from + 1,
      bodyHashAt: async () => ROOT_OK.toLowerCase(),
    });
    const anchor = makeFakeAnchor([
      {
        fromSeq: 1,
        toSeq: 100,
        rootHash: ROOT_OK.toUpperCase(),
        committer: '0xabc',
        timestamp: 1_700_000_000,
      },
    ]);
    const verifier = new LedgerVerifier(chain, anchor);
    const result = await verifier.verifyLatest();
    expect(result.commitmentsChecked).toBe(1);
  });

  it('verifyLatest skips with a warn when no commitments are on-chain yet', async () => {
    const chain = makeFakeChain({ verify: vi.fn() as never, bodyHashAt: vi.fn() as never });
    const anchor = makeFakeAnchor([]);
    const verifier = new LedgerVerifier(chain, anchor);
    const result = await verifier.verifyLatest();
    expect(result).toEqual({ verified: 0, commitmentsChecked: 0 });
  });

  it('verifyAll asserts the rootHash on every commitment (not just latest)', async () => {
    // Two commitments — both must be checked. Second one's local body_hash
    // diverges; verifyAll must catch it (pre-fix would have iterated
    // chain.verify silently for each).
    const chain = makeFakeChain({
      verify: async (from, to) => to - from + 1,
      bodyHashAt: async (seq) => {
        if (seq === 50) return ROOT_OK;
        if (seq === 100) return ROOT_TAMPERED;
        return null;
      },
    });
    const anchor = makeFakeAnchor([
      { fromSeq: 1, toSeq: 50, rootHash: ROOT_OK, committer: '0xabc', timestamp: 1_700_000_000 },
      {
        fromSeq: 51,
        toSeq: 100,
        rootHash: 'c'.repeat(64),
        committer: '0xabc',
        timestamp: 1_700_001_000,
      },
    ]);
    const verifier = new LedgerVerifier(chain, anchor);
    await expect(verifier.verifyAll()).rejects.toThrow();
  });

  it('verifyLatest still catches the pre-existing chain.verify count-mismatch failure', async () => {
    // A commitment claims 100 rows but only 99 verified — pre-existing
    // check that must keep firing after the new rootHash gate is added.
    const chain = makeFakeChain({
      verify: async () => 99, // mismatch
      bodyHashAt: async () => ROOT_OK,
    });
    const anchor = makeFakeAnchor([
      {
        fromSeq: 1,
        toSeq: 100,
        rootHash: ROOT_OK,
        committer: '0xabc',
        timestamp: 1_700_000_000,
      },
    ]);
    const verifier = new LedgerVerifier(chain, anchor);
    await expect(verifier.verifyLatest()).rejects.toThrow();
  });
});
