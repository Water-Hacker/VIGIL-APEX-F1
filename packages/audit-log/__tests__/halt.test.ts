import { describe, expect, it, vi } from 'vitest';

import { AuditEmitterUnavailableError, withHaltOnFailure } from '../src/halt.js';

describe('withHaltOnFailure', () => {
  it('runs the work when emit succeeds', async () => {
    const emit = vi.fn(async () => {});
    const work = vi.fn(async () => 42);
    const r = await withHaltOnFailure(emit, work);
    expect(r).toBe(42);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('throws AuditEmitterUnavailableError when emit fails — and DOES NOT run the work', async () => {
    const emit = vi.fn(async () => {
      throw new Error('redis-down');
    });
    const work = vi.fn(async () => 42);
    await expect(withHaltOnFailure(emit, work)).rejects.toThrow(AuditEmitterUnavailableError);
    expect(work).not.toHaveBeenCalled();
  });

  it('preserves the original cause for the operator', async () => {
    const original = new Error('postgres-down');
    const emit = vi.fn(async () => {
      throw original;
    });
    try {
      await withHaltOnFailure(emit, async () => 1);
    } catch (err) {
      expect(err).toBeInstanceOf(AuditEmitterUnavailableError);
      expect((err as AuditEmitterUnavailableError).emitterCause).toBe(original);
    }
  });
});
