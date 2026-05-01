/**
 * Block-B A9 — boot-time guard regression for POLYGON_ANCHOR_CONTRACT.
 *
 * Pins that the worker-anchor entrypoint refuses to start with:
 *   - unset env
 *   - null-address (`0x000...0`)
 *   - PLACEHOLDER literal from .env.example
 *   - any non-EVM-shape value
 *
 * Source-grep style (precedent: mou-gate-regression in adapter-runner)
 * — the guard lives inside `main()` which is a singleton entrypoint;
 * mocking it would mean rewriting half the worker. Pinning the regex
 * line is enough to catch a future PR that weakens the guard.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC = readFileSync(join(REPO_ROOT, 'apps/worker-anchor/src/index.ts'), 'utf8');

describe('Block-B A9 — POLYGON_ANCHOR_CONTRACT boot guard', () => {
  it('source contains an EVM 20-byte regex (0x + 40 hex)', () => {
    expect(SRC).toMatch(/\/\^0x\[0-9a-fA-F\]\{40\}\$\//);
  });

  it('source still rejects null-address explicitly', () => {
    // Defence-in-depth: even if the shape regex passes (it does for
    // `0x000...0` because that IS valid hex), the null check fires.
    expect(SRC).toMatch(/\/\^0x0\+\$\/i\.test\(polygonContract\)/);
  });

  it('source throws with a message naming POLYGON_ANCHOR_CONTRACT and EVM 20-byte', () => {
    expect(SRC).toMatch(/POLYGON_ANCHOR_CONTRACT is unset/);
    expect(SRC).toMatch(/EVM 20-byte address/);
    expect(SRC).toMatch(/refusing to start worker-anchor/);
  });

  it('regex correctness — pins what the shape check accepts and rejects', () => {
    // The regex from the source. Re-derive it here so a renamed
    // helper in the source still satisfies the contract.
    const isEvmAddress = (v: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(v);

    // Valid EVM addresses pass.
    expect(isEvmAddress('0x' + 'a'.repeat(40))).toBe(true);
    expect(isEvmAddress('0x' + '0'.repeat(40))).toBe(true);
    expect(isEvmAddress('0xAbCdEf0123456789aBcDeF0123456789AbCdEf01')).toBe(true);

    // The PLACEHOLDER literal from .env.example fails the shape.
    expect(isEvmAddress('PLACEHOLDER_DEPLOYED_AT_M1')).toBe(false);

    // 39 chars, 41 chars, missing 0x, non-hex chars all fail.
    expect(isEvmAddress('0x' + 'a'.repeat(39))).toBe(false);
    expect(isEvmAddress('0x' + 'a'.repeat(41))).toBe(false);
    expect(isEvmAddress('a'.repeat(40))).toBe(false);
    expect(isEvmAddress('0x' + 'g'.repeat(40))).toBe(false);
    expect(isEvmAddress('')).toBe(false);
  });
});
