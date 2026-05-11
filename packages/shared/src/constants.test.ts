import { describe, expect, it } from 'vitest';

import {
  POSTERIOR_THRESHOLD_CONAC,
  MIN_SIGNAL_COUNT_CONAC,
  meetsCONACThreshold,
} from './constants.js';

describe('CONAC threshold constants (FIND-002 single source of truth)', () => {
  it('pins the SRD §25 cutoff at posterior >= 0.95 with >= 5 sources', () => {
    expect(POSTERIOR_THRESHOLD_CONAC).toBe(0.95);
    expect(MIN_SIGNAL_COUNT_CONAC).toBe(5);
  });
});

describe('meetsCONACThreshold predicate', () => {
  it('accepts a finding at the exact threshold', () => {
    expect(meetsCONACThreshold({ posterior: 0.95, signal_count: 5 })).toBe(true);
  });

  it('accepts a finding above the threshold', () => {
    expect(meetsCONACThreshold({ posterior: 0.98, signal_count: 12 })).toBe(true);
  });

  it('rejects a finding with insufficient posterior', () => {
    expect(meetsCONACThreshold({ posterior: 0.94, signal_count: 5 })).toBe(false);
    expect(meetsCONACThreshold({ posterior: 0.8, signal_count: 100 })).toBe(false);
  });

  it('rejects a finding with insufficient signal count', () => {
    expect(meetsCONACThreshold({ posterior: 0.95, signal_count: 4 })).toBe(false);
    expect(meetsCONACThreshold({ posterior: 0.99, signal_count: 1 })).toBe(false);
  });

  it('rejects a finding with zero signals', () => {
    expect(meetsCONACThreshold({ posterior: 0.99, signal_count: 0 })).toBe(false);
  });

  it('fail-closed on null / undefined / non-numeric fields', () => {
    expect(meetsCONACThreshold({})).toBe(false);
    expect(meetsCONACThreshold({ posterior: null, signal_count: 5 })).toBe(false);
    expect(meetsCONACThreshold({ posterior: 0.95, signal_count: null })).toBe(false);
    expect(meetsCONACThreshold({ posterior: undefined, signal_count: 5 })).toBe(false);
  });

  it('fail-closed on NaN / Infinity', () => {
    expect(meetsCONACThreshold({ posterior: Number.NaN, signal_count: 5 })).toBe(false);
    expect(meetsCONACThreshold({ posterior: Number.POSITIVE_INFINITY, signal_count: 5 })).toBe(
      false,
    );
    expect(meetsCONACThreshold({ posterior: 0.95, signal_count: Number.NaN })).toBe(false);
  });

  it('regression: the borderline 0.94/5 finding cited in FIND-002 is rejected', () => {
    // The audit catalogue specifically called out this combination.
    expect(meetsCONACThreshold({ posterior: 0.94, signal_count: 5 })).toBe(false);
  });

  it('regression: a posterior 0.86 / 2-source finding from the doc-03 example is rejected', () => {
    expect(meetsCONACThreshold({ posterior: 0.86, signal_count: 2 })).toBe(false);
  });
});
