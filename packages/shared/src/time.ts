/**
 * Deterministic time helpers.
 *
 * VIGIL APEX is allergic to non-deterministic clocks. Per SRD §3.9 every
 * container's `/etc/localtime` is bind-mounted from the host; the host runs
 * chronyd against pool.ntp.org; all timestamps are stored UTC and rendered
 * in Africa/Douala only at the surface boundary.
 *
 * In application code, NEVER call `Date.now()` directly outside of this
 * module. Always use `now()` (or accept a Clock as a parameter for tests).
 */

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export type IsoInstant = string & { readonly __brand: 'IsoInstant' };
export type EpochMs = number & { readonly __brand: 'EpochMs' };

export interface Clock {
  /** Returns the current instant in milliseconds since the Unix epoch. */
  now(): EpochMs;
  /** Returns the current ISO 8601 instant (UTC). */
  isoNow(): IsoInstant;
}

class SystemClock implements Clock {
  now(): EpochMs {
    return Date.now() as EpochMs;
  }
  isoNow(): IsoInstant {
    return new Date().toISOString() as IsoInstant;
  }
}

/** Default system clock; injectable in tests for determinism. */
export const systemClock: Clock = new SystemClock();

/** A frozen-time clock; useful for unit tests. */
export class FrozenClock implements Clock {
  constructor(private readonly fixed: number) {}
  now(): EpochMs {
    return this.fixed as EpochMs;
  }
  isoNow(): IsoInstant {
    return new Date(this.fixed).toISOString() as IsoInstant;
  }
}

export function now(clock: Clock = systemClock): EpochMs {
  return clock.now();
}

export function isoNow(clock: Clock = systemClock): IsoInstant {
  return clock.isoNow();
}

export function asIsoInstant(s: string): IsoInstant {
  if (!ISO_INSTANT_RE.test(s)) throw new Error(`Not an ISO instant: ${s}`);
  // Round-trip via Date to verify it parses cleanly
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Unparseable ISO instant: ${s}`);
  return s as IsoInstant;
}

export function epochToIso(ms: EpochMs): IsoInstant {
  return new Date(ms).toISOString() as IsoInstant;
}

export function isoToEpoch(iso: IsoInstant): EpochMs {
  return new Date(iso).getTime() as EpochMs;
}

/** Duration helpers — read as English in code. */
export const seconds = (n: number): number => n * 1000;
export const minutes = (n: number): number => n * 60_000;
export const hours = (n: number): number => n * 3_600_000;
export const days = (n: number): number => n * 86_400_000;

/**
 * Convention (AUDIT-050):
 *
 * - All time values inside the @vigil/* TypeScript code are `number` ms
 *   since the Unix epoch (`EpochMs` brand). `Date.now()` style.
 * - The federation-stream wire format uses `bigint` (or `bigint | number`)
 *   ONLY because protobuf `int64` decodes to bigint in the gRPC binding.
 *   See `packages/federation-stream/src/sign.ts` (`writeFieldInt64`).
 * - Cross the boundary explicitly: `BigInt(epochMs)` on the way out,
 *   `Number(bigintMs)` on the way in. Never let bigint leak into the
 *   rest of the codebase — `EpochMs` and bigint are NOT interchangeable
 *   (arithmetic, JSON, comparisons all behave differently).
 *
 * If a future feature needs nanosecond precision (e.g. ordering events
 * inside the same millisecond), introduce a separate `BigIntNs` brand
 * here rather than overloading EpochMs.
 */
