/**
 * Tier-39 audit closure — VigilError.toJSON includes `cause`.
 *
 * Pre-T39 the toJSON serialiser dropped the cause entirely. A wrapped
 * chain `VigilError(cause: pgError)` JSON-serialised to only the outer
 * envelope — operators investigating an UNCATEGORISED 5xx had nothing
 * to chase. The cause now serialises conservatively (no stack, no
 * arbitrary enumerable props) so audit-bridge / dashboard / Loki
 * shipments carry the diagnostic without leaking upstream driver
 * stacks or SQL text.
 */
import { describe, expect, it } from 'vitest';

import { VigilError, serialiseCause, asVigilError } from './index.js';

describe('Tier-39 — VigilError.toJSON cause inclusion', () => {
  it('omits cause when undefined (back-compat)', () => {
    const e = new VigilError({ code: 'C', message: 'm' });
    const json = e.toJSON();
    expect(json['cause']).toBeUndefined();
  });

  it('includes a wrapped VigilError cause via recursive toJSON', () => {
    const inner = new VigilError({
      code: 'INNER',
      message: 'inner failure',
      context: { detail: 'inner-detail' },
    });
    const outer = new VigilError({
      code: 'OUTER',
      message: 'outer failure',
      cause: inner,
    });
    const json = outer.toJSON();
    expect(json['cause']).toMatchObject({
      code: 'INNER',
      message: 'inner failure',
      context: { detail: 'inner-detail' },
    });
  });

  it('includes a plain Error cause as { name, message } only — no stack / no upstream-leak', () => {
    const plain = new Error('pg: connection refused at /var/run/postgresql/.s.PGSQL.5432');
    const outer = new VigilError({ code: 'WRAPPED', message: 'wrapped', cause: plain });
    const json = outer.toJSON();
    expect(json['cause']).toEqual({
      name: 'Error',
      message: 'pg: connection refused at /var/run/postgresql/.s.PGSQL.5432',
    });
    // No stack field surfaces.
    expect((json['cause'] as Record<string, unknown>)['stack']).toBeUndefined();
  });

  it('serialises non-Error string causes with a prefix tag', () => {
    const outer = new VigilError({ code: 'WRAPPED', message: 'wrapped', cause: 'oops' });
    expect(outer.toJSON()['cause']).toBe('string: oops');
  });

  it('serialises non-Error non-string causes with a typeof tag', () => {
    const outer = new VigilError({ code: 'WRAPPED', message: 'wrapped', cause: { foo: 1 } });
    expect(outer.toJSON()['cause']).toBe('non-error: object');
  });

  it('JSON.stringify round-trip preserves the cause chain', () => {
    const root = new VigilError({ code: 'ROOT', message: 'root err' });
    const middle = new VigilError({ code: 'MID', message: 'mid err', cause: root });
    const top = new VigilError({ code: 'TOP', message: 'top err', cause: middle });
    const parsed = JSON.parse(JSON.stringify(top)) as Record<string, unknown>;
    expect(parsed['code']).toBe('TOP');
    const midJson = parsed['cause'] as Record<string, unknown>;
    expect(midJson['code']).toBe('MID');
    const rootJson = midJson['cause'] as Record<string, unknown>;
    expect(rootJson['code']).toBe('ROOT');
  });
});

describe('Tier-39 — serialiseCause helper', () => {
  it('handles undefined / null', () => {
    expect(serialiseCause(undefined)).toBe('non-error: undefined');
    expect(serialiseCause(null)).toBe('non-error: object');
  });

  it('handles a number / boolean', () => {
    expect(serialiseCause(42)).toBe('non-error: number');
    expect(serialiseCause(true)).toBe('non-error: boolean');
  });

  it('asVigilError + toJSON round-trips a non-VigilError cause cleanly', () => {
    const plain = new TypeError('bad arg');
    const wrapped = asVigilError(plain);
    const json = wrapped.toJSON();
    expect(json['code']).toBe('UNCATEGORISED');
    expect(json['cause']).toEqual({ name: 'TypeError', message: 'bad arg' });
  });
});
