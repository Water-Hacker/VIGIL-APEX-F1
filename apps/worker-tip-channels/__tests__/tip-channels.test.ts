import { generateBoxKeyPair } from '@vigil/security';
import { beforeAll, describe, expect, it } from 'vitest';

import { isLanguageProductionReady, menuFor } from '../src/menus.js';
import {
  encryptIncomingTip,
  formatTipReference,
  reassembleUssdSegments,
  resolveLanguage,
  voiceToIncoming,
} from '../src/tip-channels.js';

// Real X25519 keypair generated at test boot. Public key is a 32-byte
// raw value, base64-encoded — the shape libsodium's crypto_box_seal
// requires. The corresponding private key is discarded; these tests
// exercise only the encrypt path, which does not need decryption.
let TEST_PUBLIC_KEY_B64 = '';
beforeAll(async () => {
  const kp = await generateBoxKeyPair();
  TEST_PUBLIC_KEY_B64 = kp.publicKey;
});

describe('resolveLanguage', () => {
  it('returns declared language when known', () => {
    expect(resolveLanguage('fr')).toBe('fr');
    expect(resolveLanguage('en')).toBe('en');
    expect(resolveLanguage('ful')).toBe('ful');
    expect(resolveLanguage('ewo')).toBe('ewo');
    expect(resolveLanguage('cpe')).toBe('cpe');
  });

  it('falls back to fr on unknown / missing', () => {
    expect(resolveLanguage(undefined)).toBe('fr');
    expect(resolveLanguage('zz')).toBe('fr');
    expect(resolveLanguage('')).toBe('fr');
  });
});

describe('formatTipReference', () => {
  it('pads year and sequence', () => {
    expect(formatTipReference(2026, 1)).toBe('TIP-2026-0001');
    expect(formatTipReference(2026, 142)).toBe('TIP-2026-0142');
    expect(formatTipReference(2026, 9999)).toBe('TIP-2026-9999');
  });
});

describe('reassembleUssdSegments', () => {
  it('joins ordered segments', () => {
    const r = reassembleUssdSegments([
      { index: 0, text: 'Hospital award to ' },
      { index: 1, text: 'Construction Plus SARL ' },
      { index: 2, text: 'is suspicious because...' },
    ]);
    expect(r).toBe('Hospital award to Construction Plus SARL is suspicious because...');
  });

  it('handles single segment', () => {
    expect(reassembleUssdSegments([{ index: 0, text: 'one segment' }])).toBe('one segment');
  });

  it('returns empty for empty input', () => {
    expect(reassembleUssdSegments([])).toBe('');
  });

  it('reorders out-of-order segments', () => {
    const r = reassembleUssdSegments([
      { index: 2, text: 'C' },
      { index: 0, text: 'A' },
      { index: 1, text: 'B' },
    ]);
    expect(r).toBe('ABC');
  });

  it('throws on gap in segment sequence', () => {
    expect(() =>
      reassembleUssdSegments([
        { index: 0, text: 'A' },
        { index: 2, text: 'C' },
      ]),
    ).toThrow(/index mismatch/);
  });
});

describe('encryptIncomingTip', () => {
  it('produces a non-empty base64 ciphertext', async () => {
    const out = await encryptIncomingTip(
      {
        channel: 'ussd',
        language: 'fr',
        body_plaintext: 'Test observation about a procurement notice.',
        gateway_request_id: 'g-001',
        gateway_at: '2026-05-14T12:00:00Z',
      },
      TEST_PUBLIC_KEY_B64,
      new Date('2026-05-14T12:00:00Z'),
    );
    expect(out.body_ciphertext_b64).toBeTruthy();
    expect(out.body_ciphertext_b64.length).toBeGreaterThan(40);
    expect(out.channel).toBe('ussd');
    expect(out.language).toBe('fr');
    expect(out.received_at).toBe('2026-05-14T12:00:00.000Z');
  });

  it('refuses empty body', async () => {
    await expect(
      encryptIncomingTip(
        {
          channel: 'sms',
          language: 'fr',
          body_plaintext: '',
          gateway_request_id: 'g',
          gateway_at: '2026-05-14T12:00:00Z',
        },
        TEST_PUBLIC_KEY_B64,
      ),
    ).rejects.toThrow(/empty body_plaintext/);
  });

  it('refuses oversized body (> 200KB)', async () => {
    const big = 'x'.repeat(200_001);
    await expect(
      encryptIncomingTip(
        {
          channel: 'sms',
          language: 'fr',
          body_plaintext: big,
          gateway_request_id: 'g',
          gateway_at: '2026-05-14T12:00:00Z',
        },
        TEST_PUBLIC_KEY_B64,
      ),
    ).rejects.toThrow(/200KB cap/);
  });
});

describe('voiceToIncoming', () => {
  it('converts a confident transcription to descriptor', () => {
    const r = voiceToIncoming(
      {
        transcription_text: 'I saw a building site with no construction.',
        language: 'en',
        confidence: 0.85,
        duration_seconds: 45,
      },
      { request_id: 'v-001', at: '2026-05-14T12:00:00Z' },
    );
    expect(r.channel).toBe('voice');
    expect(r.language).toBe('en');
    expect(r.body_plaintext).toBe('I saw a building site with no construction.');
  });

  it('refuses low-confidence transcription', () => {
    expect(() =>
      voiceToIncoming(
        {
          transcription_text: 'unclear',
          language: 'fr',
          confidence: 0.3,
          duration_seconds: 30,
        },
        { request_id: 'v', at: '2026-05-14T12:00:00Z' },
      ),
    ).toThrow(/confidence/);
  });

  it('refuses empty transcription', () => {
    expect(() =>
      voiceToIncoming(
        {
          transcription_text: '   ',
          language: 'fr',
          confidence: 0.9,
          duration_seconds: 30,
        },
        { request_id: 'v', at: '2026-05-14T12:00:00Z' },
      ),
    ).toThrow(/empty text/);
  });
});

describe('menuFor + isLanguageProductionReady', () => {
  it('returns FR + EN menus directly', () => {
    expect(menuFor('fr').welcome).toMatch(/VIGIL APEX/);
    expect(menuFor('en').welcome).toMatch(/VIGIL APEX/);
  });

  it('marks fr and en production-ready', () => {
    expect(isLanguageProductionReady('fr')).toBe(true);
    expect(isLanguageProductionReady('en')).toBe(true);
  });

  it('marks Cameroonian-language slots as not-yet-production-ready', () => {
    expect(isLanguageProductionReady('ful')).toBe(false);
    expect(isLanguageProductionReady('ewo')).toBe(false);
    expect(isLanguageProductionReady('dua')).toBe(false);
    expect(isLanguageProductionReady('bbj')).toBe(false);
    expect(isLanguageProductionReady('cpe')).toBe(false);
  });

  it('placeholder menus carry the FR-translation-pending prefix', () => {
    const ful = menuFor('ful');
    expect(ful.welcome).toMatch(/translation pending/);
  });
});
