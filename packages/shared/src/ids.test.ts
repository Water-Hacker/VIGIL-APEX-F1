import { describe, expect, it } from 'vitest';

import {
  asDossierRef,
  asEthAddress,
  asPatternId,
  asSha256Hex,
  asSourceId,
  asTipRef,
  formatDossierRef,
  formatTipRef,
  isUuidV4,
  newFindingId,
} from './ids.js';

describe('asPatternId', () => {
  it('accepts canonical pattern IDs', () => {
    expect(asPatternId('P-A-001')).toBe('P-A-001');
    expect(asPatternId('P-H-003')).toBe('P-H-003');
  });

  it('rejects malformed pattern IDs', () => {
    expect(() => asPatternId('P-X-001')).toThrow();
    expect(() => asPatternId('P-A-1')).toThrow();
    expect(() => asPatternId('p-a-001')).toThrow();
    expect(() => asPatternId('PA001')).toThrow();
    expect(() => asPatternId('')).toThrow();
  });
});

describe('asSourceId', () => {
  it('accepts kebab-case source IDs', () => {
    expect(asSourceId('armp')).toBe('armp');
    expect(asSourceId('armp-main')).toBe('armp-main');
    expect(asSourceId('cour-des-comptes')).toBe('cour-des-comptes');
  });

  it('rejects bad source IDs', () => {
    expect(() => asSourceId('ARMP')).toThrow();
    expect(() => asSourceId('a')).toThrow(); // too short
    expect(() => asSourceId('1armp')).toThrow(); // starts with digit
    expect(() => asSourceId('armp_main')).toThrow(); // underscore
  });
});

describe('asEthAddress', () => {
  it('lowercases checksummed addresses', () => {
    const a = asEthAddress('0xAbCdEf0123456789AbCdEf0123456789AbCdEf01');
    expect(a).toBe('0xabcdef0123456789abcdef0123456789abcdef01');
  });

  it('rejects malformed addresses', () => {
    expect(() => asEthAddress('0x123')).toThrow();
    expect(() => asEthAddress('zz23456789012345678901234567890123456789012')).toThrow();
  });
});

describe('AUDIT-044 — asEthAddress canonicalization is locale-invariant', () => {
  it('all-uppercase A-F input maps to all-lowercase a-f exactly', () => {
    const a = asEthAddress('0xABCDEF0123456789ABCDEF0123456789ABCDEF01');
    expect(a).toBe('0xabcdef0123456789abcdef0123456789abcdef01');
  });

  it('mixed case canonicalises consistently across two independent calls', () => {
    const a = asEthAddress('0xAaBbCcDdEeFf0123456789aAbBcCdDeEfF012345');
    const b = asEthAddress('0xAaBbCcDdEeFf0123456789aAbBcCdDeEfF012345');
    expect(a).toBe(b);
  });

  it('regex allow-list rejects any non-ASCII character (Turkish-İ defence in depth)', () => {
    // The audit description suggested .toLowerCase() could exhibit
    // Turkish-İ behaviour. Per ES spec, .toLowerCase() (no arg) is
    // locale-invariant — only .toLocaleLowerCase() takes a locale and
    // can produce 'ı' from 'I' under tr-TR. The regex below also
    // forbids any non-[0-9a-fA-F] character, so even Turkish input
    // would reject before .toLowerCase() runs.
    expect(() => asEthAddress('0xİbCdEf0123456789AbCdEf0123456789AbCdEf01')).toThrow();
    expect(() => asEthAddress('0xAbCdEf0123456789ı_Cdef0123456789AbCdEf01')).toThrow();
  });

  it('canonicalised address is byte-identical to .toLowerCase() of the input (locale-invariant by spec)', () => {
    const inputs = [
      '0x0123456789ABCDEFabcdef0123456789ABCDEFab',
      '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '0xffffffffffffffffffffffffffffffffffffffff',
    ];
    for (const s of inputs) {
      const out = asEthAddress(s);
      expect(out).toBe(s.toLowerCase());
    }
  });
});

describe('asSha256Hex', () => {
  it('lowercases valid hex', () => {
    const h = 'A'.repeat(64);
    expect(asSha256Hex(h)).toBe('a'.repeat(64));
  });

  it('rejects wrong length', () => {
    expect(() => asSha256Hex('aabb')).toThrow();
  });
});

describe('formatDossierRef', () => {
  it('zero-pads correctly', () => {
    expect(formatDossierRef(2026, 1)).toBe('VA-2026-0001');
    expect(formatDossierRef(2026, 4242)).toBe('VA-2026-4242');
  });

  it('rejects out-of-range inputs', () => {
    expect(() => formatDossierRef(1999, 1)).toThrow();
    expect(() => formatDossierRef(2026, 0)).toThrow();
  });

  it('round-trips through asDossierRef', () => {
    const r = formatDossierRef(2026, 42);
    expect(asDossierRef(r)).toBe(r);
  });
});

describe('formatTipRef + asTipRef', () => {
  it('round-trips', () => {
    const r = formatTipRef(2026, 7);
    expect(asTipRef(r)).toBe(r);
  });
});

describe('newFindingId + isUuidV4', () => {
  it('produces a v4 UUID', () => {
    const id = newFindingId();
    expect(isUuidV4(id)).toBe(true);
  });

  it('produces unique IDs', () => {
    const a = newFindingId();
    const b = newFindingId();
    expect(a).not.toBe(b);
  });
});
