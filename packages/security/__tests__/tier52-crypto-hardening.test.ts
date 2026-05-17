/**
 * Tier-52 audit closure — crypto-core hardening tests.
 *
 * Covers three defences shipped in this tier:
 *
 *   (A) shamir.ts: bounded share count + size + strict base64 validation.
 *       Pre-fix, a malformed base64 share surfaced as a generic
 *       InvalidCharacterError from atob, masked further up as a
 *       generic shamir-combine-failure. Post-fix, the boundary
 *       rejects with clear shamir-prefixed errors.
 *
 *   (B) fido.ts: WebAuthn §6.1.1 clone-detection enforcement at the
 *       library boundary. Pre-fix the caller had to remember to
 *       compare newCounter against stored counter; post-fix the
 *       library throws FidoVerificationError on a non-monotone bump.
 *
 *   (C) sodium.ts: sealedBoxDecrypt wipes the decoded private-key
 *       byte buffer in a finally block, narrowing the binary-key
 *       heap exposure window. Not directly assertable from JS (V8
 *       internals), so this is documented as a behaviour contract
 *       via a smoke test that the decrypt still works end-to-end.
 */
import { describe, expect, it } from 'vitest';

import { expose } from '../src/secrets.js';
import {
  SHAMIR_MAX_SHARES,
  SHAMIR_MAX_SHARE_BYTES,
  shamirCombine,
  shamirCombineFromBase64,
} from '../src/shamir.js';
import { generateBoxKeyPair, sealedBoxDecrypt, sealedBoxEncrypt } from '../src/sodium.js';

describe('Tier-52 (A) — shamir bounds + base64 validation', () => {
  it('exposes SHAMIR_MAX_SHARES = 255 (GF(256) ceiling)', () => {
    expect(SHAMIR_MAX_SHARES).toBe(255);
  });

  it('exposes SHAMIR_MAX_SHARE_BYTES = 64 KiB (1000x headroom over libsodium SK)', () => {
    expect(SHAMIR_MAX_SHARE_BYTES).toBe(64 * 1024);
  });

  it('rejects > SHAMIR_MAX_SHARES with structured shamir error', () => {
    // 256 minimal shares, each [x=i, y=0]. Most will be duplicate-x
    // anyway, but the cap fires FIRST so we get the cap error not the
    // dup-x error.
    const many = Array.from({ length: 256 }, (_, i) => new Uint8Array([(i % 255) + 1, 0]));
    expect(() => shamirCombine(many)).toThrow(/exceeds max 255/);
  });

  it('rejects over-sized individual share with structured shamir error', () => {
    const oversize = new Uint8Array(SHAMIR_MAX_SHARE_BYTES + 2);
    oversize[0] = 1;
    expect(() => shamirCombine([oversize, new Uint8Array(SHAMIR_MAX_SHARE_BYTES + 2)])).toThrow(
      /exceeds max 65536/,
    );
  });

  it('rejects empty / non-string base64 input', () => {
    expect(() => shamirCombineFromBase64([''])).toThrow(/empty or non-string/);
  });

  it('rejects base64 with non-standard characters (clear shamir-prefixed error)', () => {
    // '@' is not in the standard base64 alphabet.
    expect(() => shamirCombineFromBase64(['AB@CD'])).toThrow(/malformed base64 share/);
  });

  it('rejects base64 whose length is not a multiple of 4', () => {
    expect(() => shamirCombineFromBase64(['ABC'])).toThrow(/multiple of 4/);
  });

  it('accepts well-formed base64 (no false-positive on real shares)', () => {
    // Two trivial shares for a 1-byte secret = 0x42. f(x) = 0x42 + 0x37*x
    // share 1: x=1, y=0x42^0x37=0x75 → bytes [1, 0x75] → base64 "AXU="
    // share 2: x=2, y=0x42^gfMul(0x37, 2) — we'll just exercise the
    // base64-validation path with placeholder bytes; the math correctness
    // is covered by the existing shamir.test.ts cases.
    // Use a known-good 2-byte share: [0x01, 0x00] → "AQA="
    const r = shamirCombineFromBase64(['AQA=', 'AgA=']);
    expect(expose(r)).toBeInstanceOf(Uint8Array);
  });
});

describe('Tier-52 (C) — sealedBoxDecrypt round-trips correctly post-wipe-fix', () => {
  it('encrypts and decrypts a known plaintext (smoke test the wipe added in finally)', async () => {
    const kp = await generateBoxKeyPair();
    const plaintext = 'tier-52 hardening smoke test plaintext';
    const c = await sealedBoxEncrypt(plaintext, kp.publicKey);
    const decoded = await sealedBoxDecrypt(c, kp.publicKey, kp.privateKey);
    expect(new TextDecoder().decode(decoded)).toBe(plaintext);
  });

  it('wipe-on-throw: decrypt failure does not swallow original error', async () => {
    const kp = await generateBoxKeyPair();
    const other = await generateBoxKeyPair();
    const c = await sealedBoxEncrypt('whatever', kp.publicKey);
    // Decrypt with the wrong private key — sodium throws; we must
    // still see that throw (the new finally{ memzero(sk) } must not
    // mask it).
    await expect(sealedBoxDecrypt(c, kp.publicKey, other.privateKey)).rejects.toThrow();
  });
});

// FIDO clone-detection tests live inline in fido.ts — exercising
// verifyAuthentication requires either a real WebAuthn assertion
// (impractical in unit tests) or mocking @simplewebauthn/server's
// verifyAuthenticationResponse. The dashboard's webauthn-fallback-e2e
// test already exercises the verifyAuthentication path with a real
// fixture; this tier's change is a defence-in-depth check ADDED to
// that same function. A source-grep regression test pins the new check.
describe('Tier-52 (B) — FIDO clone-detection source-grep regression', () => {
  it('verifyAuthentication source carries the clone-detection check', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/fido.ts', import.meta.url), 'utf8');
    // The new check compares stored counter > 0 + newCounter <= stored.
    expect(src).toContain('o.credential.counter > 0 && newCounter <= o.credential.counter');
    expect(src).toContain('WebAuthn §6.1.1');
    expect(src).toContain('possible authenticator clone');
  });
});
