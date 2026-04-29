import { describe, expect, it } from 'vitest';

import { generateBoxKeyPair, sealedBoxDecrypt, sealedBoxEncrypt } from '../src/sodium.js';

describe('sodium sealed-box', () => {
  it('round-trips plaintext through sealed-box (string input)', async () => {
    const { publicKey, privateKey } = await generateBoxKeyPair();
    const ct = await sealedBoxEncrypt('hello vigil', publicKey);
    const pt = await sealedBoxDecrypt(ct, publicKey, privateKey);
    expect(new TextDecoder().decode(pt)).toBe('hello vigil');
  });

  it('round-trips plaintext through sealed-box (bytes input)', async () => {
    const { publicKey, privateKey } = await generateBoxKeyPair();
    const msg = new Uint8Array([0x00, 0xff, 0x10, 0x20, 0x30]);
    const ct = await sealedBoxEncrypt(msg, publicKey);
    const pt = await sealedBoxDecrypt(ct, publicKey, privateKey);
    expect(Array.from(pt)).toEqual(Array.from(msg));
  });

  it('rejects ciphertext encrypted to a different public key', async () => {
    const a = await generateBoxKeyPair();
    const b = await generateBoxKeyPair();
    const ct = await sealedBoxEncrypt('private', a.publicKey);
    await expect(sealedBoxDecrypt(ct, b.publicKey, b.privateKey)).rejects.toThrow();
  });

  it('rejects tampered ciphertext', async () => {
    const { publicKey, privateKey } = await generateBoxKeyPair();
    const ct = await sealedBoxEncrypt('private', publicKey);
    const tampered = ct.slice(0, -2) + (ct[ct.length - 2] === 'A' ? 'BB' : 'AA');
    await expect(sealedBoxDecrypt(tampered, publicKey, privateKey)).rejects.toThrow();
  });
});
