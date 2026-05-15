import { describe, expect, it } from 'vitest';

import {
  AUTH_PROOF_HEADER,
  AUTH_PROOF_TS_HEADER,
  REQUEST_ID_HEADER,
  generateRequestId,
  mintAuthProof,
  verifyAuthProof,
} from '../src/lib/auth-proof';

/**
 * Mode 4.3 — TOCTOU between middleware verify and downstream re-read.
 *
 * mintAuthProof + verifyAuthProof together let downstream API routes
 * and server components refuse identity headers that didn't come
 * through middleware. The tests below lock the contract.
 */

const KEY = 'test-signing-key-not-for-production';

function makeHeaders(rec: Record<string, string>): { get(name: string): string | null } {
  return {
    get(name: string): string | null {
      // Case-insensitive lookup like a real Headers object.
      const lower = name.toLowerCase();
      for (const k of Object.keys(rec)) {
        if (k.toLowerCase() === lower) return rec[k]!;
      }
      return null;
    },
  };
}

describe('auth-proof primitive (mode 4.3)', () => {
  it('mint + verify round-trips on identical input', () => {
    const ts = 1_700_000_000_000;
    const input = {
      actor: 'user-abc',
      username: 'alice',
      rolesRealm: ['operator'],
      rolesResource: ['auditor'],
      requestId: 'req-xyz',
      timestampMs: ts,
    };
    const proof = mintAuthProof(input, KEY);

    const headers = makeHeaders({
      [AUTH_PROOF_HEADER]: proof,
      [AUTH_PROOF_TS_HEADER]: String(ts),
      [REQUEST_ID_HEADER]: 'req-xyz',
      'x-vigil-user': 'user-abc',
      'x-vigil-username': 'alice',
      'x-vigil-roles-realm': 'operator',
      'x-vigil-roles-resource': 'auditor',
    });

    const r = verifyAuthProof(headers, { key: KEY, nowMs: ts + 1_000 });
    expect(r.ok).toBe(true);
    expect(r.actor).toBe('user-abc');
    expect(r.rolesRealm).toEqual(['operator']);
    expect(r.rolesResource).toEqual(['auditor']);
  });

  it('REJECTS a proof when the actor header is tampered with', () => {
    const ts = 1_700_000_000_000;
    const proof = mintAuthProof(
      {
        actor: 'user-abc',
        username: null,
        rolesRealm: ['operator'],
        rolesResource: [],
        requestId: 'req-1',
        timestampMs: ts,
      },
      KEY,
    );

    const headers = makeHeaders({
      [AUTH_PROOF_HEADER]: proof,
      [AUTH_PROOF_TS_HEADER]: String(ts),
      [REQUEST_ID_HEADER]: 'req-1',
      'x-vigil-user': 'attacker-spoofed', // tampered!
      'x-vigil-roles-realm': 'operator',
    });
    const r = verifyAuthProof(headers, { key: KEY, nowMs: ts });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('mismatch');
  });

  it('REJECTS a proof when a role is added/removed', () => {
    const ts = 1_700_000_000_000;
    const proof = mintAuthProof(
      {
        actor: 'user-abc',
        username: null,
        rolesRealm: ['operator'],
        rolesResource: [],
        requestId: 'req-1',
        timestampMs: ts,
      },
      KEY,
    );

    // Attacker adds 'architect' (a privilege-escalating role).
    const headers = makeHeaders({
      [AUTH_PROOF_HEADER]: proof,
      [AUTH_PROOF_TS_HEADER]: String(ts),
      [REQUEST_ID_HEADER]: 'req-1',
      'x-vigil-user': 'user-abc',
      'x-vigil-roles-realm': 'operator,architect',
    });
    const r = verifyAuthProof(headers, { key: KEY, nowMs: ts });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('mismatch');
  });

  it('REJECTS a stale proof (outside the freshness window)', () => {
    const ts = 1_700_000_000_000;
    const proof = mintAuthProof(
      {
        actor: 'user-abc',
        username: null,
        rolesRealm: ['operator'],
        rolesResource: [],
        requestId: 'req-1',
        timestampMs: ts,
      },
      KEY,
    );

    const headers = makeHeaders({
      [AUTH_PROOF_HEADER]: proof,
      [AUTH_PROOF_TS_HEADER]: String(ts),
      [REQUEST_ID_HEADER]: 'req-1',
      'x-vigil-user': 'user-abc',
      'x-vigil-roles-realm': 'operator',
    });

    // 10 minutes later — outside the default 5-minute window.
    const r = verifyAuthProof(headers, { key: KEY, nowMs: ts + 10 * 60 * 1_000 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('stale');
  });

  it('REJECTS a future-dated proof (clock-skew or adversarial pre-mint)', () => {
    const ts = 1_700_000_000_000;
    const proof = mintAuthProof(
      {
        actor: 'user-abc',
        username: null,
        rolesRealm: [],
        rolesResource: [],
        requestId: 'req-1',
        timestampMs: ts,
      },
      KEY,
    );

    const headers = makeHeaders({
      [AUTH_PROOF_HEADER]: proof,
      [AUTH_PROOF_TS_HEADER]: String(ts),
      [REQUEST_ID_HEADER]: 'req-1',
      'x-vigil-user': 'user-abc',
    });

    // Verify with `now` set 1 minute BEFORE the proof was minted.
    // 10s skew tolerance < 60s offset → rejected.
    const r = verifyAuthProof(headers, { key: KEY, nowMs: ts - 60_000 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('stale');
  });

  it('returns missing-proof when the AUTH_PROOF_HEADER is absent', () => {
    const headers = makeHeaders({
      [AUTH_PROOF_TS_HEADER]: String(Date.now()),
      'x-vigil-user': 'user-abc',
    });
    const r = verifyAuthProof(headers, { key: KEY });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing-proof');
  });

  it('returns missing-timestamp when AUTH_PROOF_TS_HEADER is absent', () => {
    const headers = makeHeaders({
      [AUTH_PROOF_HEADER]: 'a'.repeat(64),
      'x-vigil-user': 'user-abc',
    });
    const r = verifyAuthProof(headers, { key: KEY });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing-timestamp');
  });

  it('returns missing-key when no signing key is configured (env unset and not passed)', () => {
    // Ensure env is clean for this assertion.
    const prior = process.env.VIGIL_AUTH_PROOF_KEY;
    delete process.env.VIGIL_AUTH_PROOF_KEY;
    try {
      const headers = makeHeaders({
        [AUTH_PROOF_HEADER]: 'a'.repeat(64),
        [AUTH_PROOF_TS_HEADER]: String(Date.now()),
      });
      const r = verifyAuthProof(headers);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('missing-key');
    } finally {
      if (prior !== undefined) process.env.VIGIL_AUTH_PROOF_KEY = prior;
    }
  });

  it('role-list ordering does NOT change the proof (canonical sort)', () => {
    const ts = 1_700_000_000_000;
    const p1 = mintAuthProof(
      {
        actor: 'a',
        username: null,
        rolesRealm: ['operator', 'auditor', 'architect'],
        rolesResource: ['council_member'],
        requestId: 'r',
        timestampMs: ts,
      },
      KEY,
    );
    const p2 = mintAuthProof(
      {
        actor: 'a',
        username: null,
        rolesRealm: ['architect', 'operator', 'auditor'], // reordered
        rolesResource: ['council_member'],
        requestId: 'r',
        timestampMs: ts,
      },
      KEY,
    );
    expect(p1).toBe(p2);
  });

  it('mintAuthProof THROWS when no key is configured and none passed', () => {
    const prior = process.env.VIGIL_AUTH_PROOF_KEY;
    delete process.env.VIGIL_AUTH_PROOF_KEY;
    try {
      expect(() =>
        mintAuthProof({
          actor: 'a',
          username: null,
          rolesRealm: [],
          rolesResource: [],
          requestId: 'r',
          timestampMs: Date.now(),
        }),
      ).toThrow(/VIGIL_AUTH_PROOF_KEY/);
    } finally {
      if (prior !== undefined) process.env.VIGIL_AUTH_PROOF_KEY = prior;
    }
  });

  it('generateRequestId returns 32 hex chars from a CSPRNG', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).toMatch(/^[0-9a-f]{32}$/);
    expect(id2).toMatch(/^[0-9a-f]{32}$/);
    expect(id1).not.toBe(id2);
  });

  it('uses constant-time comparison (timingSafeEqual) — does not throw on length-mismatched proof', () => {
    const ts = 1_700_000_000_000;
    const headers = makeHeaders({
      [AUTH_PROOF_HEADER]: 'too-short',
      [AUTH_PROOF_TS_HEADER]: String(ts),
      'x-vigil-user': 'a',
    });
    // Different length than a real 64-hex HMAC — must short-circuit
    // safely rather than throw, AND return mismatch (not crash).
    const r = verifyAuthProof(headers, { key: KEY, nowMs: ts });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('mismatch');
  });
});
