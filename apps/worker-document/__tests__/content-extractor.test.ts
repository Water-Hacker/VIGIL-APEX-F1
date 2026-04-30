/**
 * Document content-extractor tests — protest disposition + progress
 * percentage parsing. Closes the production-input gap for P-A-008
 * and P-D-005.
 */
import { describe, expect, it } from 'vitest';

import {
  extractDocContent,
  extractProgressPct,
  extractProtestDisposition,
} from '../src/content-extractor.js';

describe('extractProtestDisposition', () => {
  it('detects "rejet de la plainte" as rejected', () => {
    expect(extractProtestDisposition("La plainte fait l'objet d'un rejet")?.value).toBe('rejected');
  });
  it('detects "irrecevable" as inadmissible', () => {
    expect(
      extractProtestDisposition('La plainte est jugée irrecevable par la commission')?.value,
    ).toBe('inadmissible');
  });
  it('detects "fondée" as upheld', () => {
    expect(extractProtestDisposition('La plainte est jugée fondée')?.value).toBe('upheld');
  });
  it('detects "partiellement fondée" before "fondée" (longer-match wins by ordering)', () => {
    expect(
      extractProtestDisposition('La plainte est partiellement fondée pour ce qui concerne...')
        ?.value,
    ).toBe('partially_upheld');
  });
  it('detects English "dismissed" as rejected', () => {
    expect(extractProtestDisposition('The complaint is dismissed.')?.value).toBe('rejected');
  });
  it('returns null when no disposition keyword present', () => {
    expect(extractProtestDisposition('Random unrelated text')).toBeNull();
  });
});

describe('extractProgressPct', () => {
  it('parses "Exécution physique: 45 %"', () => {
    expect(extractProgressPct('Exécution physique: 45 %')?.value).toBe(45);
  });
  it('parses "Avancement: 60%"', () => {
    expect(extractProgressPct('Avancement: 60%')?.value).toBe(60);
  });
  it('parses "Physical progress: 35 percent"', () => {
    expect(extractProgressPct('Physical progress: 35 percent')?.value).toBe(35);
  });
  it('parses decimal values with comma separator', () => {
    expect(extractProgressPct('Avancement: 42,5 %')?.value).toBe(42.5);
  });
  it('parses decimal values with dot separator', () => {
    expect(extractProgressPct('Avancement: 42.5 %')?.value).toBe(42.5);
  });
  it('rejects values > 100', () => {
    expect(extractProgressPct('Exécution physique: 250 %')).toBeNull();
  });
  it('returns the highest value when multiple progress mentions present', () => {
    expect(
      extractProgressPct('Exécution physique du lot 1: 30 % — Exécution physique du lot 2: 80 %')
        ?.value,
    ).toBe(80);
  });
  it('returns null on missing cue', () => {
    expect(extractProgressPct('Random text without progress cue')).toBeNull();
  });
  it('handles "Taux d\'exécution: 75 %"', () => {
    expect(extractProgressPct("Taux d'exécution: 75 %")?.value).toBe(75);
  });
});

describe('extractDocContent — kind routing', () => {
  it('extracts protest_disposition for audit_observation kind', () => {
    const r = extractDocContent({
      sourceId: 'cour-des-comptes',
      eventKind: 'audit_observation',
      ocrText: 'Décision: la plainte est jugée irrecevable.',
    });
    expect(r.additions['protest_disposition']).toBe('inadmissible');
    expect(r.provenance['protest_disposition']).toBe('doc-content:disposition.inadmissible');
  });

  it('extracts progress_pct for investment_project kind', () => {
    const r = extractDocContent({
      sourceId: 'minepat-bip',
      eventKind: 'investment_project',
      ocrText: 'Avancement physique: 70 %',
    });
    expect(r.additions['progress_pct']).toBe(70);
    expect(r.provenance['progress_pct']).toBe('doc-content:progress.exec-physique-fr');
  });

  it('returns empty for unrelated event kind', () => {
    const r = extractDocContent({
      sourceId: 'cm-armp-main',
      eventKind: 'award',
      ocrText: 'Avancement: 50 %',
    });
    expect(r.additions).toEqual({});
    expect(r.provenance).toEqual({});
  });

  it('returns empty when text contains no relevant cue', () => {
    const r = extractDocContent({
      sourceId: 'cour-des-comptes',
      eventKind: 'audit_observation',
      ocrText: 'Lorem ipsum dolor sit amet',
    });
    expect(r.additions).toEqual({});
  });

  it('clamps very large input without ReDoS', () => {
    const giant = 'X'.repeat(2_000_000) + 'Avancement: 80 %';
    const start = Date.now();
    const r = extractDocContent({
      sourceId: 'minepat-bip',
      eventKind: 'investment_project',
      ocrText: giant,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
    // The progress cue was after MAX_TEXT_SCAN (400k) — should NOT be found.
    expect(r.additions).toEqual({});
  });

  it('returns deterministic output for identical input', () => {
    const a = extractDocContent({
      sourceId: 'cour-des-comptes',
      eventKind: 'audit_observation',
      ocrText: 'plainte rejetée par décision motivée',
    });
    const b = extractDocContent({
      sourceId: 'cour-des-comptes',
      eventKind: 'audit_observation',
      ocrText: 'plainte rejetée par décision motivée',
    });
    expect(a).toEqual(b);
  });
});
