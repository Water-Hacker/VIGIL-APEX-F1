/**
 * T3 of TODO.md sweep — close worker-dossier's zero-test gap.
 *
 * Pins three Tier-58 audit closures that previously had no test cover:
 *   1. PDF size cap — 50 MiB ceiling rejects pathological renders.
 *   2. LibreOffice timeout — SIGKILL after wall-clock deadline.
 *   3. Stderr capture — soffice exit-N error carries up to 4 KiB of
 *      stderr tail so operators can diagnose the failure.
 *   4. Dev-unsigned fallback gating — the DEV-UNSIGNED- prefix is
 *      load-bearing for worker-conac-sftp's refusal path.
 */
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  MAX_PDF_BYTES,
  STDERR_CAP_BYTES,
  assertPdfWithinCap,
  computeDevUnsignedFingerprint,
  devUnsignedAllowed,
  runLibreOffice,
} from '../src/libreoffice.js';

import type { ChildProcess } from 'node:child_process';

/* -------------------------------------------------------------------------- */
/* assertPdfWithinCap                                                          */
/* -------------------------------------------------------------------------- */

describe('assertPdfWithinCap', () => {
  it('accepts a typical 250 KiB dossier PDF', () => {
    expect(() => assertPdfWithinCap(250 * 1024)).not.toThrow();
  });

  it('accepts exactly the cap (boundary)', () => {
    expect(() => assertPdfWithinCap(MAX_PDF_BYTES)).not.toThrow();
  });

  it('throws on cap + 1 byte', () => {
    expect(() => assertPdfWithinCap(MAX_PDF_BYTES + 1)).toThrow(
      /oversized PDF: \d+ bytes > cap \d+/,
    );
  });

  it('error message contains both the actual size and the cap (operator-debugging contract)', () => {
    try {
      assertPdfWithinCap(MAX_PDF_BYTES + 1);
      throw new Error('expected throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toContain(String(MAX_PDF_BYTES + 1));
      expect(msg).toContain(String(MAX_PDF_BYTES));
    }
  });
});

/* -------------------------------------------------------------------------- */
/* runLibreOffice                                                              */
/* -------------------------------------------------------------------------- */

interface FakeChild extends EventEmitter {
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe('runLibreOffice — successful render', () => {
  it('resolves when soffice exits 0', async () => {
    const child = makeFakeChild();
    const spawnImpl = vi.fn(() => child as unknown as ChildProcess);
    const p = runLibreOffice('/tmp/a.docx', '/tmp/out', { spawnImpl, timeoutMs: 10_000 });
    // Emit exit on the next tick.
    setImmediate(() => child.emit('close', 0));
    await expect(p).resolves.toBeUndefined();
    expect(spawnImpl).toHaveBeenCalledWith(
      'soffice',
      expect.arrayContaining(['--headless', '--convert-to']),
    );
  });
});

describe('runLibreOffice — failure paths', () => {
  it('rejects with stderr tail when soffice exits non-zero', async () => {
    const child = makeFakeChild();
    const spawnImpl = vi.fn(() => child as unknown as ChildProcess);
    const p = runLibreOffice('/tmp/a.docx', '/tmp/out', { spawnImpl, timeoutMs: 10_000 });
    setImmediate(() => {
      child.stderr.emit('data', Buffer.from('libreoffice: missing font helvetica\n', 'utf8'));
      child.emit('close', 77);
    });
    await expect(p).rejects.toThrow(/soffice exited 77; stderr: libreoffice: missing font/);
  });

  it('truncates captured stderr to STDERR_CAP_BYTES', async () => {
    const child = makeFakeChild();
    const spawnImpl = vi.fn(() => child as unknown as ChildProcess);
    const p = runLibreOffice('/tmp/a.docx', '/tmp/out', { spawnImpl, timeoutMs: 10_000 });
    // Push 10 KiB of stderr — implementation caps capture at STDERR_CAP_BYTES.
    const noisy = Buffer.alloc(10 * 1024, 0x41); // 10 KiB of 'A'
    setImmediate(() => {
      child.stderr.emit('data', noisy);
      child.emit('close', 1);
    });
    try {
      await p;
      throw new Error('expected reject');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Body of the message after "stderr: " — within cap.
      const idx = msg.indexOf('stderr: ');
      const tail = msg.slice(idx + 'stderr: '.length);
      expect(tail.length).toBeLessThanOrEqual(STDERR_CAP_BYTES);
    }
  });

  it('SIGKILLs and rejects with a timeout error when soffice runs past timeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild();
      const spawnImpl = vi.fn(() => child as unknown as ChildProcess);
      const p = runLibreOffice('/tmp/a.docx', '/tmp/out', { spawnImpl, timeoutMs: 100 });
      // Trip the timer.
      await vi.advanceTimersByTimeAsync(150);
      // The timer SIGKILLs the child; production code's close handler then
      // observes the kill (in real exec) and emits 'close' with signal.
      // Simulate that here:
      child.emit('close', null);
      await expect(p).rejects.toThrow(/exceeded 100ms timeout \(SIGKILLed\)/);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects on child error (e.g. ENOENT spawn)', async () => {
    const child = makeFakeChild();
    const spawnImpl = vi.fn(() => child as unknown as ChildProcess);
    const p = runLibreOffice('/tmp/a.docx', '/tmp/out', { spawnImpl, timeoutMs: 10_000 });
    setImmediate(() => child.emit('error', new Error('ENOENT: soffice not found')));
    await expect(p).rejects.toThrow(/ENOENT/);
  });
});

/* -------------------------------------------------------------------------- */
/* computeDevUnsignedFingerprint                                               */
/* -------------------------------------------------------------------------- */

describe('computeDevUnsignedFingerprint', () => {
  it('prefixes the fingerprint with DEV-UNSIGNED- (load-bearing for conac-sftp refusal)', () => {
    const fp = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
    expect(computeDevUnsignedFingerprint(fp)).toBe(`DEV-UNSIGNED-${fp}`);
  });

  it('the prefix is stable — tier-1 audit closure depends on the exact string', () => {
    // worker-conac-sftp greps `signature_fingerprint.startsWith('DEV-UNSIGNED-')`
    // to refuse delivery. If this prefix changes, that guard breaks.
    expect(computeDevUnsignedFingerprint('any').startsWith('DEV-UNSIGNED-')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* devUnsignedAllowed gating                                                   */
/* -------------------------------------------------------------------------- */

describe('devUnsignedAllowed', () => {
  it('returns false when VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER is unset', () => {
    expect(devUnsignedAllowed({ NODE_ENV: 'development', VIGIL_PHASE: '0' })).toBe(false);
  });

  it('returns true only when all three conditions match (opt-in + non-prod + phase < 1)', () => {
    expect(
      devUnsignedAllowed({
        VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER: 'true',
        NODE_ENV: 'development',
        VIGIL_PHASE: '0',
      }),
    ).toBe(true);
  });

  it('returns false in production even with opt-in (safety net)', () => {
    expect(
      devUnsignedAllowed({
        VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER: 'true',
        NODE_ENV: 'production',
        VIGIL_PHASE: '0',
      }),
    ).toBe(false);
  });

  it('returns false at Phase 1 or later even with opt-in', () => {
    expect(
      devUnsignedAllowed({
        VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER: 'true',
        NODE_ENV: 'development',
        VIGIL_PHASE: '1',
      }),
    ).toBe(false);
  });

  it('requires the literal string "true" — VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER=1 does NOT count', () => {
    expect(
      devUnsignedAllowed({
        VIGIL_DEV_ALLOW_UNSIGNED_DOSSIER: '1',
        NODE_ENV: 'development',
        VIGIL_PHASE: '0',
      }),
    ).toBe(false);
  });
});
