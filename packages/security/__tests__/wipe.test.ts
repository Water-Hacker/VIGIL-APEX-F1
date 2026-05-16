import { describe, expect, it } from 'vitest';

import { wipe } from '../src/sodium.js';

describe('sodium wipe (Tier-16 audit closure)', () => {
  it('zeros every byte of a non-empty Uint8Array', async () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await wipe(buf);
    expect(Array.from(buf)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('zeros a large buffer (simulated decrypted plaintext)', async () => {
    const buf = new Uint8Array(8 * 1024);
    for (let i = 0; i < buf.length; i++) buf[i] = (i % 251) + 1; // never zero
    await wipe(buf);
    expect(buf.every((b) => b === 0)).toBe(true);
  });

  it('is a no-op for length-0 buffers (the ZERO_BYTES sentinel)', async () => {
    const empty = new Uint8Array(0);
    await wipe(empty); // must not throw
    expect(empty.length).toBe(0);
  });

  it('tolerates null', async () => {
    await wipe(null); // must not throw
  });

  it('tolerates undefined', async () => {
    await wipe(undefined); // must not throw
  });

  it('is idempotent — wiping an already-zero buffer leaves it zero', async () => {
    const buf = new Uint8Array([0, 0, 0, 0]);
    await wipe(buf);
    await wipe(buf);
    expect(Array.from(buf)).toEqual([0, 0, 0, 0]);
  });

  it('wipes a freshly-allocated 32-byte buffer (Shamir SK size)', async () => {
    const sk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) sk[i] = i + 1;
    await wipe(sk);
    expect(sk.every((b) => b === 0)).toBe(true);
  });
});
