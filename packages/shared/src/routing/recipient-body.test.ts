import { describe, expect, it } from 'vitest';

import {
  parsePatternId,
  recipientBodyHeaders,
  recommendRecipientBody,
} from './recipient-body.js';

describe('recommendRecipientBody', () => {
  it('routes pre-disbursement findings to MINFI regardless of category', () => {
    expect(
      recommendRecipientBody({
        patternCategory: 'A',
        severity: 'high',
        preDisbursementFlag: true,
      }),
    ).toBe('MINFI');
    expect(
      recommendRecipientBody({
        patternCategory: 'D',
        severity: 'low',
        preDisbursementFlag: true,
      }),
    ).toBe('MINFI');
  });

  it('routes critical procurement-adjacent findings to Cour des Comptes', () => {
    for (const category of ['A', 'B', 'C', 'F'] as const) {
      expect(recommendRecipientBody({ patternCategory: category, severity: 'critical' })).toBe(
        'COUR_DES_COMPTES',
      );
    }
  });

  it('routes default cases per pattern category mandate', () => {
    expect(recommendRecipientBody({ patternCategory: 'A', severity: 'high' })).toBe('CONAC');
    expect(recommendRecipientBody({ patternCategory: 'B', severity: 'medium' })).toBe('CONAC');
    expect(recommendRecipientBody({ patternCategory: 'C', severity: 'low' })).toBe('CONAC');
    expect(recommendRecipientBody({ patternCategory: 'D', severity: 'high' })).toBe(
      'COUR_DES_COMPTES',
    );
    expect(recommendRecipientBody({ patternCategory: 'E', severity: 'medium' })).toBe('ANIF');
    expect(recommendRecipientBody({ patternCategory: 'F', severity: 'low' })).toBe('CONAC');
    expect(recommendRecipientBody({ patternCategory: 'G', severity: 'high' })).toBe(
      'COUR_DES_COMPTES',
    );
    expect(recommendRecipientBody({ patternCategory: 'H', severity: 'medium' })).toBe('CONAC');
  });

  it('non-procurement categories ignore the critical-severity escalator', () => {
    // D, E, G, H stay on their default body even when critical
    expect(recommendRecipientBody({ patternCategory: 'D', severity: 'critical' })).toBe(
      'COUR_DES_COMPTES',
    );
    expect(recommendRecipientBody({ patternCategory: 'E', severity: 'critical' })).toBe('ANIF');
    expect(recommendRecipientBody({ patternCategory: 'G', severity: 'critical' })).toBe(
      'COUR_DES_COMPTES',
    );
    expect(recommendRecipientBody({ patternCategory: 'H', severity: 'critical' })).toBe('CONAC');
  });
});

describe('parsePatternId', () => {
  it('parses well-formed pattern ids', () => {
    expect(parsePatternId('P-A-001')).toEqual({ category: 'A', index: 1 });
    expect(parsePatternId('P-D-005')).toEqual({ category: 'D', index: 5 });
    expect(parsePatternId('P-H-042')).toEqual({ category: 'H', index: 42 });
  });

  it('rejects malformed pattern ids', () => {
    expect(parsePatternId('P-Z-001')).toBeNull();
    expect(parsePatternId('P-A-1')).toBeNull();
    expect(parsePatternId('p-a-001')).toBeNull();
    expect(parsePatternId('A-001')).toBeNull();
    expect(parsePatternId('')).toBeNull();
  });
});

describe('recipientBodyHeaders', () => {
  it('returns bilingual formal-register headers for every body', () => {
    const bodies = ['CONAC', 'COUR_DES_COMPTES', 'MINFI', 'ANIF', 'CDC', 'OTHER'] as const;
    for (const body of bodies) {
      const h = recipientBodyHeaders(body);
      expect(h.fr.addressee).toBeTruthy();
      expect(h.fr.title).toBeTruthy();
      expect(h.en.addressee).toBeTruthy();
      expect(h.en.title).toBeTruthy();
      // Formal register sanity check on FR headers
      if (body !== 'OTHER') {
        expect(h.fr.addressee).toMatch(/Monsieur|Madame|Directeur/);
      }
    }
  });
});
