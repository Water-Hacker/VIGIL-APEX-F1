import { describe, expect, it } from 'vitest';

import { VIGIL_OWNED_PATTERNS, isVigilOwned, parseMode, toError } from '../pin-image-digests.js';

/**
 * Mode 9.8 — pin-image-digests pure-helper tests.
 *
 * The digest-pin script has four pure helpers worth pinning under
 * unit tests (the resolver itself shells out to `crane`/`docker`,
 * which requires the binary + network and is exercised by the
 * release-path integration job):
 *
 *   - isVigilOwned: vigil-namespace pattern match.
 *   - VIGIL_OWNED_PATTERNS: keep the namespace list literal-stable.
 *   - parseMode: CLI flag → Mode mapping.
 *   - toError: normalise unknown throwables to Error.
 *
 * Cases that gate review issues:
 *   - Issue #2 (array-of-patterns): each pattern hit and miss is asserted.
 *   - Issue #3 (better error context): toError preserves non-Error cause.
 *   - Issue #1 (--verify-complete): parseMode recognises the new flag.
 */

describe('isVigilOwned', () => {
  it('matches vigil-apex/* tags', () => {
    expect(isVigilOwned('vigil-apex/worker-pattern:0.1.0')).toBe(true);
    expect(isVigilOwned('vigil-apex/dashboard:latest')).toBe(true);
  });

  it('matches the vigil-caddy image with or without a tag', () => {
    expect(isVigilOwned('vigil-caddy:2.7.6')).toBe(true);
    expect(isVigilOwned('vigil-caddy')).toBe(true);
  });

  it('matches the local registry namespace', () => {
    expect(isVigilOwned('registry.vigilapex.local/foo:1.0')).toBe(true);
    expect(isVigilOwned('registry.vigilapex.local:5000/foo:1.0')).toBe(true);
  });

  it('does not match upstream/public image refs', () => {
    expect(isVigilOwned('node:20.20.2-alpine')).toBe(false);
    expect(isVigilOwned('postgres:16.4')).toBe(false);
    expect(isVigilOwned('docker.io/library/redis:7.4')).toBe(false);
    expect(isVigilOwned('ghcr.io/some-org/some-img:1.0')).toBe(false);
  });

  it('does not match a name that merely contains "vigil-apex" as a substring', () => {
    // Anchored at start — a third-party registry that happens to
    // share the name is NOT vigil-owned. This is the defence against
    // a malicious public image squatting our prefix.
    expect(isVigilOwned('attacker.example/vigil-apex/foo:1.0')).toBe(false);
  });
});

describe('VIGIL_OWNED_PATTERNS', () => {
  it('is an array (not a single regex), so additions are one-line', () => {
    // Issue #2 — explicit list-of-patterns instead of a single conflated
    // regex. The literal shape is part of the public surface.
    expect(Array.isArray(VIGIL_OWNED_PATTERNS)).toBe(true);
    expect(VIGIL_OWNED_PATTERNS.length).toBeGreaterThanOrEqual(3);
    for (const p of VIGIL_OWNED_PATTERNS) expect(p).toBeInstanceOf(RegExp);
  });

  it('every pattern is anchored at the start (^)', () => {
    // Anchoring at the start prevents substring-based squatting.
    for (const p of VIGIL_OWNED_PATTERNS) {
      expect(p.source.startsWith('^')).toBe(true);
    }
  });
});

describe('parseMode', () => {
  it('defaults to verify when no flag is given', () => {
    expect(parseMode([])).toBe('verify');
  });

  it('recognises --apply', () => {
    expect(parseMode(['--apply'])).toBe('apply');
  });

  it('recognises --dry-run', () => {
    expect(parseMode(['--dry-run'])).toBe('dry-run');
  });

  it('recognises --verify-complete (Issue #1)', () => {
    expect(parseMode(['--verify-complete'])).toBe('verify-complete');
  });

  it('prefers --apply over --dry-run when both are passed (one-shot wins)', () => {
    // --apply is the destructive operation; if the caller passed both,
    // they almost certainly meant the destructive one — falling back
    // silently to dry-run would surprise an operator running a release.
    expect(parseMode(['--dry-run', '--apply'])).toBe('apply');
  });
});

describe('toError', () => {
  it('returns Errors unchanged (preserves stack)', () => {
    const orig = new Error('boom');
    expect(toError(orig)).toBe(orig);
  });

  it('wraps a string with the string as message', () => {
    const e = toError('plain string');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('plain string');
  });

  it('wraps a non-Error object and preserves the original as cause', () => {
    const payload = { code: 'ENOENT', path: '/dev/null/x' };
    const e = toError(payload);
    expect(e).toBeInstanceOf(Error);
    // Cause carries the original object so structured loggers can pick it up.
    expect((e as Error & { cause?: unknown }).cause).toEqual(payload);
  });

  it('wraps a number with a JSON-stringified message', () => {
    const e = toError(42);
    expect(e.message).toBe('42');
    expect((e as Error & { cause?: unknown }).cause).toBe(42);
  });
});
