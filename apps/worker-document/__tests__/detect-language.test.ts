/**
 * worker-document — language-detection contract.
 *
 * SRD §14: detect FR / EN / unknown for OCR'd text. Cameroon-specific
 * fallback: too-short text or unrecognised African languages → 'fr' (the
 * national procurement-portal default), structured payloads → 'unknown'.
 */
import { describe, expect, it } from 'vitest';

import { detectLanguage } from '../src/lang.js';

describe('worker-document detectLanguage', () => {
  it('returns "unknown" for application/json regardless of text', () => {
    expect(detectLanguage('the contract was signed in Yaoundé', 'application/json')).toBe(
      'unknown',
    );
    expect(detectLanguage(null, 'application/json')).toBe('unknown');
  });

  it('returns "unknown" for application/xml', () => {
    expect(detectLanguage('<doc>x</doc>', 'application/xml')).toBe('unknown');
  });

  it('falls back to FR for null / empty / sub-24-char text', () => {
    expect(detectLanguage(null, 'application/pdf')).toBe('fr');
    expect(detectLanguage('', 'application/pdf')).toBe('fr');
    expect(detectLanguage('   ', 'application/pdf')).toBe('fr');
    expect(detectLanguage('short text', 'application/pdf')).toBe('fr');
  });

  it('detects French text on a procurement-style passage', () => {
    const fr =
      'Le marché a été attribué à la société TOTALENERGIES Cameroun pour la fourniture ' +
      "de services de transport entre Yaoundé et Douala. Le montant total s'élève à 5 milliards de francs CFA.";
    expect(detectLanguage(fr, 'application/pdf')).toBe('fr');
  });

  it('detects English text on a procurement-style passage', () => {
    const en =
      'The contract was awarded to TotalEnergies Cameroon for the provision of transport services ' +
      'between Yaoundé and Douala. The total amount is five billion CFA francs.';
    expect(detectLanguage(en, 'application/pdf')).toBe('en');
  });

  it('returns "fr" as the default for unrecognised African-language text', () => {
    // franc returns 'fra' for many low-resource codes when not recognised; the
    // worker falls back to FR per the Cameroonian procurement-portal default.
    expect(detectLanguage('????? ????? ????? ?????', 'application/pdf')).toBe('fr');
  });

  it('handles plain UTF-8 text/plain MIME', () => {
    const en = 'The auditor confirmed that the procurement procedure was followed correctly.';
    expect(detectLanguage(en, 'text/plain')).toBe('en');
  });
});
