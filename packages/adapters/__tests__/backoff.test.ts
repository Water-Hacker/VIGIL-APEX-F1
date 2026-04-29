import { describe, expect, it, vi } from 'vitest';

import { isTransientError, runWithBackoff } from '../src/backoff.js';

describe('isTransientError', () => {
  it('flags ECONNRESET / ETIMEDOUT messages as transient', () => {
    expect(isTransientError(new Error('socket ECONNRESET'))).toBe(true);
    expect(isTransientError(new Error('ETIMEDOUT after 30s'))).toBe(true);
    expect(isTransientError(new Error('getaddrinfo ENOTFOUND host.local'))).toBe(true);
  });

  it('flags errno-style code as transient', () => {
    const err = Object.assign(new Error('boom'), { code: 'ECONNRESET' });
    expect(isTransientError(err)).toBe(true);
  });

  it('flags 5xx HTTP status errors as transient', () => {
    const err = Object.assign(new Error('boom'), { statusCode: 503 });
    expect(isTransientError(err)).toBe(true);
    const err2 = Object.assign(new Error('boom'), { status: 500 });
    expect(isTransientError(err2)).toBe(true);
  });

  it('does NOT flag 4xx as transient (parser must surface those)', () => {
    const err = Object.assign(new Error('not found'), { statusCode: 404 });
    expect(isTransientError(err)).toBe(false);
  });

  it('does NOT flag generic errors as transient', () => {
    expect(isTransientError(new Error('out of memory'))).toBe(false);
  });
});

describe('runWithBackoff', () => {
  it('returns immediately when fn succeeds on attempt 1', async () => {
    const fn = vi.fn(async () => 'ok');
    const out = await runWithBackoff(fn, { delaysMs: [0, 1, 1] });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors and eventually succeeds', async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n++;
      if (n < 3) throw Object.assign(new Error('boom'), { statusCode: 503 });
      return 'ok';
    });
    const out = await runWithBackoff(fn, { delaysMs: [0, 1, 1], attempts: 3 });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry non-transient errors', async () => {
    const err = Object.assign(new Error('forbidden'), { statusCode: 403 });
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(runWithBackoff(fn, { delaysMs: [0, 1, 1] })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws the last error after the attempt budget', async () => {
    const fn = vi.fn(async () => {
      throw Object.assign(new Error('boom'), { statusCode: 502 });
    });
    await expect(runWithBackoff(fn, { delaysMs: [0, 1, 1], attempts: 3 })).rejects.toThrow(/boom/);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
