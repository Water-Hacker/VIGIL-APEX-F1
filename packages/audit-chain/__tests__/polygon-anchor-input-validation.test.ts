/**
 * Tier-40 audit closure — PolygonAnchor.commit boundary validation
 * + LocalWalletAdapter production guard.
 *
 * PolygonAnchor is the wrapper between worker-anchor and the on-chain
 * VIGILAnchor.sol contract. T15 added on-chain `InvalidRange` /
 * `NonContiguous` reverts; reaching the YubiKey signer + the chain
 * only to revert is wasted gas + a wasted YubiKey touch. T40 pushes
 * the validation to the client boundary.
 *
 * LocalWalletAdapter holds a plaintext EOA private key — strictly
 * dev-only — and previously enforced that only via a comment.
 */
import { ethers } from 'ethers';
import { describe, expect, it, vi } from 'vitest';

import { LocalWalletAdapter, PolygonAnchor, type SignerAdapter } from '../src/polygon-anchor.js';

const VALID_HASH = 'a'.repeat(64);

function stubSigner(): SignerAdapter {
  return {
    sendTransaction: vi.fn(async () => '0xabc'),
    getAddress: vi.fn(async () => '0x0000000000000000000000000000000000000001'),
  };
}

function makeAnchor(signer: SignerAdapter = stubSigner()): PolygonAnchor {
  // The provider is constructed by the anchor; we point it at a
  // throwaway URL because the commit-rejection paths fire BEFORE the
  // gas-price read. The address-shape doesn't matter for the
  // pre-validation checks under test.
  return new PolygonAnchor({
    rpcUrl: 'http://127.0.0.1:1',
    contractAddress: '0x0000000000000000000000000000000000000000',
    signer,
    chainId: 137,
  });
}

describe('Tier-40 — PolygonAnchor.commit input validation', () => {
  it('rejects fromSeq < 1', async () => {
    const a = makeAnchor();
    await expect(a.commit(0, 10, VALID_HASH)).rejects.toThrow(/fromSeq must be a positive integer/);
    await expect(a.commit(-1, 10, VALID_HASH)).rejects.toThrow(
      /fromSeq must be a positive integer/,
    );
  });

  it('rejects non-integer fromSeq', async () => {
    const a = makeAnchor();
    await expect(a.commit(1.5, 10, VALID_HASH)).rejects.toThrow(
      /fromSeq must be a positive integer/,
    );
  });

  it('rejects toSeq < fromSeq', async () => {
    const a = makeAnchor();
    await expect(a.commit(10, 5, VALID_HASH)).rejects.toThrow(
      /toSeq must be an integer >= fromSeq/,
    );
  });

  it('rejects toSeq past Number.MAX_SAFE_INTEGER (T20 ceiling)', async () => {
    const a = makeAnchor();
    await expect(a.commit(1, Number.MAX_SAFE_INTEGER + 100, VALID_HASH)).rejects.toThrow(
      /SEQ_PRECISION_CEILING|exceeds Number\.MAX_SAFE_INTEGER/,
    );
  });

  it('rejects non-hex / wrong-length root hash', async () => {
    const a = makeAnchor();
    await expect(a.commit(1, 10, 'not-hex')).rejects.toThrow(/64-hex-char/);
    await expect(a.commit(1, 10, 'a'.repeat(63))).rejects.toThrow(/64-hex-char/);
  });

  it('input validation runs BEFORE any provider call', async () => {
    // Stub a signer that would explode if called; the rejections above
    // must not reach it.
    const explode: SignerAdapter = {
      sendTransaction: vi.fn(async () => {
        throw new Error('should not be reached');
      }),
      getAddress: vi.fn(async () => '0x0000000000000000000000000000000000000001'),
    };
    const a = makeAnchor(explode);
    await expect(a.commit(0, 10, VALID_HASH)).rejects.toThrow(/fromSeq/);
    expect(explode.sendTransaction).not.toHaveBeenCalled();
  });
});

describe('Tier-40 — LocalWalletAdapter production guard', () => {
  // Real privateKey for ethers.Wallet construction in dev; doesn't matter
  // which one as long as it's a valid 32-byte hex.
  const KEY = '0x' + 'a'.repeat(64);

  it('constructs cleanly in NODE_ENV=development', () => {
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const provider = new ethers.JsonRpcProvider('http://127.0.0.1:1', 137);
      expect(() => new LocalWalletAdapter(KEY, provider)).not.toThrow();
    } finally {
      process.env.NODE_ENV = prior;
    }
  });

  it('constructs cleanly in NODE_ENV=test', () => {
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const provider = new ethers.JsonRpcProvider('http://127.0.0.1:1', 137);
      expect(() => new LocalWalletAdapter(KEY, provider)).not.toThrow();
    } finally {
      process.env.NODE_ENV = prior;
    }
  });

  it('REFUSES to instantiate in NODE_ENV=production', () => {
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const provider = new ethers.JsonRpcProvider('http://127.0.0.1:1', 137);
      expect(() => new LocalWalletAdapter(KEY, provider)).toThrow(
        /refuses to instantiate.*production.*UnixSocketSignerAdapter/,
      );
    } finally {
      process.env.NODE_ENV = prior;
    }
  });
});
