import { describe, expect, it } from 'vitest';

import {
  asEurMinor,
  asUsdMinor,
  asXaf,
  formatXaf,
  MONEY_SAFE_CEILING,
  severityForXaf,
  xafToEurReference,
} from './money.js';

describe('asXaf', () => {
  it('accepts integers', () => {
    expect(asXaf(0)).toBe(0);
    expect(asXaf(1_000_000)).toBe(1_000_000);
  });

  it('rejects non-integers', () => {
    expect(() => asXaf(1.5)).toThrow();
    expect(() => asXaf(Number.NaN)).toThrow();
  });

  it('rejects out-of-range', () => {
    expect(() => asXaf(1e20)).toThrow();
  });
});

describe('severityForXaf — SRD §06.4 thresholds', () => {
  it('partitions correctly at boundaries', () => {
    expect(severityForXaf(asXaf(0))).toBe('low');
    expect(severityForXaf(asXaf(49_999_999))).toBe('low');
    expect(severityForXaf(asXaf(50_000_000))).toBe('medium');
    expect(severityForXaf(asXaf(199_999_999))).toBe('medium');
    expect(severityForXaf(asXaf(200_000_000))).toBe('high');
    expect(severityForXaf(asXaf(999_999_999))).toBe('high');
    expect(severityForXaf(asXaf(1_000_000_000))).toBe('critical');
    expect(severityForXaf(asXaf(50_000_000_000))).toBe('critical');
  });
});

describe('xafToEurReference', () => {
  it('converts via the CFA peg', () => {
    // 655.957 XAF/EUR; 6_559_570 XAF should be ~10000 EUR ≈ 1_000_000 cents
    const eur = xafToEurReference(asXaf(6_559_570));
    expect(eur).toBeGreaterThan(999_900);
    expect(eur).toBeLessThan(1_000_100);
  });
});

describe('formatXaf', () => {
  it('renders fr-CM grouped', () => {
    const s = formatXaf(asXaf(4_250_000));
    expect(s).toMatch(/4.250.000 FCFA/); // unicode space or thin space
  });
});

describe('AUDIT-048 — money brands enforce MONEY_SAFE_CEILING', () => {
  it('MONEY_SAFE_CEILING is 1e15 (well below Number.MAX_SAFE_INTEGER)', () => {
    expect(MONEY_SAFE_CEILING).toBe(1e15);
    expect(MONEY_SAFE_CEILING).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('asXaf accepts at exactly the ceiling', () => {
    expect(asXaf(MONEY_SAFE_CEILING)).toBe(MONEY_SAFE_CEILING);
  });

  it('asXaf rejects just above the ceiling', () => {
    expect(() => asXaf(MONEY_SAFE_CEILING + 1)).toThrow(/safe range/);
  });

  it('asXaf rejects negative just below the floor', () => {
    expect(() => asXaf(-MONEY_SAFE_CEILING - 1)).toThrow(/safe range/);
  });

  it('asEurMinor accepts at exactly the ceiling', () => {
    expect(asEurMinor(MONEY_SAFE_CEILING)).toBe(MONEY_SAFE_CEILING);
  });

  it('asEurMinor rejects just above the ceiling (pre-AUDIT-048: silently passed)', () => {
    expect(() => asEurMinor(MONEY_SAFE_CEILING + 1)).toThrow(/safe range/);
  });

  it('asUsdMinor accepts at exactly the ceiling', () => {
    expect(asUsdMinor(MONEY_SAFE_CEILING)).toBe(MONEY_SAFE_CEILING);
  });

  it('asUsdMinor rejects just above the ceiling (pre-AUDIT-048: silently passed)', () => {
    expect(() => asUsdMinor(MONEY_SAFE_CEILING + 1)).toThrow(/safe range/);
  });
});
