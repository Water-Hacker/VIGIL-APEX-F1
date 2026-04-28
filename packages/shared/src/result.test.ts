import { describe, expect, it } from 'vitest';

import { err, isErr, isOk, map, mapErr, ok, tryCatch, unwrap, unwrapOr } from './result.js';

describe('Result<T,E>', () => {
  it('ok / err narrowing', () => {
    const r1 = ok(42);
    const r2 = err(new Error('boom'));
    expect(isOk(r1)).toBe(true);
    expect(isErr(r1)).toBe(false);
    expect(isOk(r2)).toBe(false);
    expect(isErr(r2)).toBe(true);
  });

  it('unwrap throws on err', () => {
    expect(unwrap(ok(42))).toBe(42);
    expect(() => unwrap(err(new Error('x')))).toThrow('x');
  });

  it('unwrapOr returns fallback on err', () => {
    expect(unwrapOr(ok(7), 0)).toBe(7);
    expect(unwrapOr(err(new Error('x')), 0)).toBe(0);
  });

  it('map only fires on ok', () => {
    const r = map(ok(2), (n) => n * 3);
    expect(r).toEqual({ ok: true, value: 6 });
  });

  it('mapErr only fires on err', () => {
    const r = mapErr(err('x'), (s) => `wrapped:${s}`);
    expect(r).toEqual({ ok: false, error: 'wrapped:x' });
  });

  it('tryCatch wraps async throws', async () => {
    const success = await tryCatch(async () => 1);
    const failure = await tryCatch(async () => {
      throw new Error('nope');
    });
    expect(success).toEqual({ ok: true, value: 1 });
    expect(failure.ok).toBe(false);
  });
});
