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
