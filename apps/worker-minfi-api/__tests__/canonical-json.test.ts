/**
 * Tier-8 outbound-delivery audit — canonical JSON for MINFI signing.
 *
 * Pre-fix, the MINFI scoring API used `JSON.stringify(req.body)` for
 * ECDSA-SHA256 signature verification and `JSON.stringify(response)`
 * for response signing. JSON.stringify is NOT canonical — `{a:1,b:2}`
 * and `{b:2,a:1}` produce different byte sequences for the same JSON
 * value. Any signer (MINFI) that emits canonical-form bytes and any
 * verifier (us) that uses Node's iteration order cannot agree on what
 * was signed unless key orders coincidentally match.
 *
 * The integration hasn't gone live yet (MINFI's public key is not yet
 * provisioned — the route falls back to "minfi-pubkey-not-provisioned"
 * 503 in non-dev), so the bug never surfaced. Catching it here.
 *
 * These tests pin:
 *   - key-order independence (the core property)
 *   - recursive sort (nested objects + arrays)
 *   - round-trip stability (canonical(parsed(canonical(x))) = canonical(x))
 *   - end-to-end: sign with key K over canonical form X, verify with
 *     paired pubkey over canonical form X. Demonstrates the bug fix
 *     is sufficient for ECDSA verification across reordered bodies.
 */
import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalJson, sortKeysDeep } from '../src/canonical-json.js';

describe('canonicalJson — key-order independence', () => {
  it('produces identical bytes for objects with the same content but different key order', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('JSON.stringify (pre-fix) produces DIFFERENT bytes for the same logical value', () => {
    // Sanity / negative control: this is the bug we're closing.
    // The order Node iterates depends on insertion; the two are not
    // byte-equal even though they're semantically identical.
    expect(JSON.stringify({ a: 1, b: 2 })).not.toBe(JSON.stringify({ b: 2, a: 1 }));
  });

  it('recursively sorts nested objects', () => {
    const a = canonicalJson({ outer: { c: 3, a: 1, b: 2 }, alpha: { z: 'z', a: 'a' } });
    const b = canonicalJson({ alpha: { a: 'a', z: 'z' }, outer: { b: 2, c: 3, a: 1 } });
    expect(a).toBe(b);
  });

  it('preserves array element order (arrays are sequence-typed, not bag-typed)', () => {
    // Arrays MUST NOT be reordered — the semantics differ.
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it('sorts keys inside objects nested in arrays', () => {
    const a = canonicalJson([
      { b: 2, a: 1 },
      { d: 4, c: 3 },
    ]);
    const b = canonicalJson([
      { a: 1, b: 2 },
      { c: 3, d: 4 },
    ]);
    expect(a).toBe(b);
  });

  it('handles primitives (number, string, boolean, null) unchanged', () => {
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('foo')).toBe('"foo"');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(null)).toBe('null');
  });

  it('round-trips: canonical(parse(canonical(x))) === canonical(x)', () => {
    const x = { z: { a: [1, 2, { c: 'c', b: 'b' }] }, a: 'a' };
    const c1 = canonicalJson(x);
    const c2 = canonicalJson(JSON.parse(c1));
    expect(c2).toBe(c1);
  });
});

describe('sortKeysDeep — direct unit cases', () => {
  it('returns primitives unchanged', () => {
    expect(sortKeysDeep(42)).toBe(42);
    expect(sortKeysDeep('foo')).toBe('foo');
    expect(sortKeysDeep(null)).toBe(null);
  });

  it('returns array-shaped values with each element sorted-deep', () => {
    const out = sortKeysDeep([{ b: 1, a: 2 }]) as Array<Record<string, unknown>>;
    expect(Object.keys(out[0]!)).toEqual(['a', 'b']);
  });

  it('sorts keys at every level', () => {
    const out = sortKeysDeep({ z: { y: 1, x: 2 }, a: 0 }) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['a', 'z']);
    expect(Object.keys(out['z'] as Record<string, unknown>)).toEqual(['x', 'y']);
  });
});

describe('canonicalJson — ECDSA signature round-trip (the actual bug fix)', () => {
  it('ECDSA-SHA256 signature verifies across re-ordered keys (proves the fix is sufficient)', () => {
    // Generate an ECDSA P-256 keypair for the test.
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

    // The "MINFI" side (signer) emits a body and computes a signature
    // over its canonical form.
    const minfiBody = { z: 'last', a: 'first', m: { nested: 1, again: 2 } };
    const minfiCanonical = canonicalJson(minfiBody);
    const sig = createSign('SHA256').update(minfiCanonical).sign(privateKey, 'base64');

    // The wire-format body might arrive at our verifier in ANY key
    // order — JSON has no key-order spec. Reorder it.
    const wireBodyDifferentOrder = { a: 'first', m: { again: 2, nested: 1 }, z: 'last' };
    const ourCanonical = canonicalJson(wireBodyDifferentOrder);

    // Pre-fix: ourCanonical would be JSON.stringify of the reordered
    // body, which differs from minfiCanonical → verification fails.
    // Post-fix: both sides canonicalise to the same byte sequence.
    expect(ourCanonical).toBe(minfiCanonical);
    const verified = createVerify('SHA256').update(ourCanonical).verify(publicKey, sig, 'base64');
    expect(verified).toBe(true);
  });
});
