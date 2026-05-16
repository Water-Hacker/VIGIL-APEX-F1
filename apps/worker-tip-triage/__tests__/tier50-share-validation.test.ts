/**
 * Tier-50 audit closure — duplicate-share rejection in tip-triage.
 *
 * The 3-of-5 council quorum (SRD §28.4) requires DISTINCT shares —
 * Shamir's secret sharing is built on polynomial interpolation, so
 * combining identical shares produces a malformed key. Pre-fix, the
 * worker did not validate share uniqueness at the boundary; duplicate
 * shares surfaced opaquely as a `decrypt-failure` later in the flow.
 *
 * Two failure modes the gate now catches:
 *
 *   (a) Caller bug: the dashboard's /triage/tips/decrypt route
 *       accidentally re-submits one council share three times.
 *       Pre-fix: looks like a decrypt-failure, no clue what went
 *       wrong. Post-fix: structured `duplicate-decryption-shares`
 *       reason names the actual defect.
 *
 *   (b) Single-member attempt to clear quorum alone. A compromised
 *       or malicious dashboard could submit the same council member's
 *       share three times in the hope of single-handedly satisfying
 *       the 3-of-5 quorum. The math doesn't work (you still need
 *       polynomially-independent points), but the SHAPE of the
 *       attack is visible at the worker boundary now.
 *
 * Test below uses minimal mocks — no actual crypto setup needed
 * since the gate fires BEFORE any decryption attempt.
 */
import { describe, expect, it, vi } from 'vitest';

import { handleTip, type TipTriageDeps, type TipTriagePayload } from '../src/triage-flow.js';

import type { Envelope } from '@vigil/queue';

const TIP_ID = '11111111-1111-1111-1111-111111111111';

function makeMinimalDeps(): {
  deps: TipTriageDeps;
  tipRepoGetById: ReturnType<typeof vi.fn>;
  vaultRead: ReturnType<typeof vi.fn>;
  safeCall: ReturnType<typeof vi.fn>;
  loggerError: ReturnType<typeof vi.fn>;
} {
  const tipRepoGetById = vi.fn();
  const vaultRead = vi.fn();
  const safeCall = vi.fn();
  const loggerError = vi.fn();
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerError,
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  } as never;
  const deps: TipTriageDeps = {
    tipRepo: { getById: tipRepoGetById, setDisposition: vi.fn() } as never,
    vault: { read: vaultRead } as never,
    safe: { call: safeCall } as never,
    modelId: 'test-model',
    logger,
  };
  return { deps, tipRepoGetById, vaultRead, safeCall, loggerError };
}

function mkEnvelope(shares: string[]): Envelope<TipTriagePayload> {
  return {
    id: 'evt-1',
    dedup_key: 'd-1',
    correlation_id: 'c-1',
    producer: 'test',
    produced_at: '2026-01-01T00:00:00Z',
    schema_version: 1,
    payload: { tip_id: TIP_ID, decryption_shares: shares },
  };
}

describe('Tier-50 — duplicate decryption shares are rejected at the worker boundary', () => {
  it('rejects 3 identical shares with structured duplicate-decryption-shares reason', async () => {
    const { deps, tipRepoGetById, vaultRead, safeCall, loggerError } = makeMinimalDeps();
    const r = await handleTip(deps, mkEnvelope(['share-A', 'share-A', 'share-A']));
    expect(r).toEqual({ kind: 'dead-letter', reason: 'duplicate-decryption-shares' });
    // Crucially, the gate fires BEFORE any I/O — no Vault read, no
    // tip-repo lookup, no LLM call.
    expect(vaultRead).not.toHaveBeenCalled();
    expect(tipRepoGetById).not.toHaveBeenCalled();
    expect(safeCall).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledOnce();
    // The error log carries submitted vs unique counts for forensics.
    const [logFields] = loggerError.mock.calls[0]!;
    expect(logFields).toMatchObject({ tip_id: TIP_ID, submitted: 3, unique: 1 });
  });

  it('rejects 2 distinct + 1 duplicate (3 submitted, 2 unique)', async () => {
    const { deps, loggerError } = makeMinimalDeps();
    const r = await handleTip(deps, mkEnvelope(['share-A', 'share-B', 'share-A']));
    expect(r).toEqual({ kind: 'dead-letter', reason: 'duplicate-decryption-shares' });
    const [logFields] = loggerError.mock.calls[0]!;
    expect(logFields).toMatchObject({ submitted: 3, unique: 2 });
  });

  it('rejects all 5 shares where 2 are duplicates (5 submitted, 3 unique)', async () => {
    const { deps } = makeMinimalDeps();
    const r = await handleTip(deps, mkEnvelope(['s-A', 's-B', 's-A', 's-C', 's-B']));
    expect(r).toEqual({ kind: 'dead-letter', reason: 'duplicate-decryption-shares' });
  });

  it('passes shares through to downstream logic when all are unique (no false-positive)', async () => {
    // We can't easily run the full happy path without real crypto fixtures
    // (the existing tor-flow-e2e covers that). Here we just assert the
    // gate does NOT fire on a 3-unique-shares payload — the downstream
    // lookup runs, returns null (tip not found), and we get the
    // tip-not-found rejection instead.
    const { deps, tipRepoGetById } = makeMinimalDeps();
    tipRepoGetById.mockResolvedValue(null);
    const r = await handleTip(deps, mkEnvelope(['s-A', 's-B', 's-C']));
    expect(r).toEqual({ kind: 'dead-letter', reason: 'tip not found' });
    expect(tipRepoGetById).toHaveBeenCalledOnce();
  });
});
