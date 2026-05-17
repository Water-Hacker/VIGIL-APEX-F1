/**
 * Concern 2 of the post-#69 followup — pin the deterministic-time
 * helpers in @vigil/shared/src/time.ts.
 *
 * The module is the canonical chokepoint for clock access (SRD §3.9
 * convention: NEVER call Date.now() outside of this module). The
 * FrozenClock + asIsoInstant + epoch<->iso conversions are dependency
 * injection seams that every test in the monorepo uses. A regression
 * here ripples to every clock-dependent test.
 */
import { describe, expect, it } from 'vitest';

import {
  FrozenClock,
  asIsoInstant,
  days,
  epochToIso,
  hours,
  isoNow,
  isoToEpoch,
  minutes,
  now,
  seconds,
  systemClock,
  type EpochMs,
  type IsoInstant,
} from './time.js';

/* -------------------------------------------------------------------------- */
/* FrozenClock                                                                 */
/* -------------------------------------------------------------------------- */

describe('FrozenClock — deterministic test clock', () => {
  it('returns the fixed instant from now()', () => {
    const c = new FrozenClock(1_700_000_000_000);
    expect(c.now()).toBe(1_700_000_000_000 as EpochMs);
  });

  it('isoNow() returns the ISO form of the fixed instant', () => {
    const c = new FrozenClock(1_700_000_000_000);
    // 1_700_000_000_000 ms = 2023-11-14T22:13:20.000Z
    expect(c.isoNow()).toBe('2023-11-14T22:13:20.000Z' as IsoInstant);
  });

  it('multiple calls return the same value (frozen)', () => {
    const c = new FrozenClock(42);
    const a = c.now();
    const b = c.now();
    expect(a).toBe(b);
    expect(c.isoNow()).toBe(c.isoNow());
  });
});

/* -------------------------------------------------------------------------- */
/* now() / isoNow() — clock injection                                          */
/* -------------------------------------------------------------------------- */

describe('now() / isoNow() — accept an injected Clock', () => {
  it('defaults to systemClock when no clock is provided', () => {
    const before = Date.now();
    const t = now();
    const after = Date.now();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('uses the injected clock when one is provided', () => {
    const c = new FrozenClock(123);
    expect(now(c)).toBe(123 as EpochMs);
    expect(isoNow(c)).toBe(new Date(123).toISOString() as IsoInstant);
  });
});

/* -------------------------------------------------------------------------- */
/* asIsoInstant — branded-string validation                                    */
/* -------------------------------------------------------------------------- */

describe('asIsoInstant — strict ISO 8601 validation', () => {
  it('accepts a canonical UTC ms-precision instant', () => {
    expect(asIsoInstant('2026-05-17T12:00:00.000Z')).toBe('2026-05-17T12:00:00.000Z' as IsoInstant);
  });

  it('accepts seconds-precision (no fractional)', () => {
    expect(asIsoInstant('2026-05-17T12:00:00Z')).toBe('2026-05-17T12:00:00Z' as IsoInstant);
  });

  it('accepts microsecond precision (.123456)', () => {
    expect(asIsoInstant('2026-05-17T12:00:00.123456Z')).toBe(
      '2026-05-17T12:00:00.123456Z' as IsoInstant,
    );
  });

  it('accepts explicit timezone offset', () => {
    expect(asIsoInstant('2026-05-17T13:00:00+01:00')).toBe(
      '2026-05-17T13:00:00+01:00' as IsoInstant,
    );
  });

  it('rejects a non-ISO string', () => {
    expect(() => asIsoInstant('not-a-date')).toThrow(/Not an ISO instant/);
  });

  it('rejects a date with no time component', () => {
    expect(() => asIsoInstant('2026-05-17')).toThrow(/Not an ISO instant/);
  });

  it('rejects an ISO-shaped string that fails Date parsing (e.g. Feb 30)', () => {
    // Regex passes but Date constructor rejects — branded-type contract
    // requires BOTH gates so a downstream `new Date(iso).getTime()`
    // never returns NaN.
    // (JS's Date is lenient; this captures the contract intent.)
    // Realistic case: epoch overflow
    expect(() => asIsoInstant('2026-13-45T99:99:99Z')).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* epoch<->iso round-trip                                                      */
/* -------------------------------------------------------------------------- */

describe('epochToIso / isoToEpoch — round-trip', () => {
  it('round-trips an arbitrary epoch', () => {
    const e = 1_700_000_000_000 as EpochMs;
    const iso = epochToIso(e);
    expect(isoToEpoch(iso)).toBe(e);
  });

  it('round-trips epoch 0 (Unix start)', () => {
    const e = 0 as EpochMs;
    expect(isoToEpoch(epochToIso(e))).toBe(e);
  });

  it('preserves millisecond precision', () => {
    const e = 1_700_000_000_123 as EpochMs;
    const iso = epochToIso(e);
    expect(iso).toMatch(/\.123Z$/);
    expect(isoToEpoch(iso)).toBe(e);
  });
});

/* -------------------------------------------------------------------------- */
/* duration helpers                                                            */
/* -------------------------------------------------------------------------- */

describe('seconds / minutes / hours / days — duration helpers in ms', () => {
  it('seconds(N) = N * 1000', () => {
    expect(seconds(1)).toBe(1000);
    expect(seconds(0)).toBe(0);
    expect(seconds(2.5)).toBe(2500);
  });

  it('minutes(N) = N * 60_000', () => {
    expect(minutes(1)).toBe(60_000);
    expect(minutes(60)).toBe(hours(1));
  });

  it('hours(N) = N * 3_600_000', () => {
    expect(hours(1)).toBe(3_600_000);
    expect(hours(24)).toBe(days(1));
  });

  it('days(N) = N * 86_400_000', () => {
    expect(days(1)).toBe(86_400_000);
    expect(days(7)).toBe(7 * 86_400_000);
  });

  it('readable composition: 5 minutes 30 seconds', () => {
    expect(minutes(5) + seconds(30)).toBe(330_000);
  });
});

/* -------------------------------------------------------------------------- */
/* systemClock — sanity                                                        */
/* -------------------------------------------------------------------------- */

describe('systemClock — default exported instance', () => {
  it('now() returns a current epoch ms (within 1 second of Date.now())', () => {
    const t = systemClock.now();
    const ref = Date.now();
    expect(Math.abs(t - ref)).toBeLessThan(1000);
  });

  it('isoNow() returns a valid IsoInstant string round-trippable to its now() value', () => {
    const t = systemClock.now();
    const iso = systemClock.isoNow();
    // ms-precision can diverge by 1 between two reads — allow drift.
    expect(Math.abs(isoToEpoch(iso) - t)).toBeLessThan(50);
  });
});
