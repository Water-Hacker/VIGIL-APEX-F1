import { describe, expect, it } from 'vitest';

import { generateQrPng } from '../src/qr.js';

describe('@vigil/dossier — QR helper', () => {
  it('returns a non-empty PNG buffer for a verify URL', async () => {
    const png = await generateQrPng('https://verify.vigilapex.cm/VA-2026-0001');
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.length).toBeGreaterThan(100);
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('produces a deterministic PNG for the same payload (same byte length range)', async () => {
    const a = await generateQrPng('VA-2026-0001');
    const b = await generateQrPng('VA-2026-0001');
    // Identical payloads with identical encoder settings yield identical bytes.
    expect(a.equals(b)).toBe(true);
  });

  it('produces different PNGs for different payloads', async () => {
    const a = await generateQrPng('VA-2026-0001');
    const b = await generateQrPng('VA-2026-0002');
    expect(a.equals(b)).toBe(false);
  });
});
