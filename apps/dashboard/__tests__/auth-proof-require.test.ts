/**
 * Tier-17 audit closure — `requireAuthProof` route gate tests.
 *
 * The middleware mints an HMAC over the identity headers (mode 4.3).
 * Before T17 no API route consumed the proof, so a middleware bypass
 * could spoof `x-vigil-roles` directly into a write endpoint. These
 * tests pin that `requireAuthProof`:
 *
 *   1. Accepts a request with a valid proof + matching role.
 *   2. Rejects a request with a forged role header (proof says one
 *      thing, header says another).
 *   3. Rejects a request with no proof at all (in production mode).
 *   4. Rejects a stale proof (timestamp older than 5 min).
 *   5. Falls back to the legacy role-header check in dev when no
 *      signing key is configured.
 *   6. Fails closed (503) in production when no signing key is set.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AUTH_PROOF_HEADER,
  AUTH_PROOF_TS_HEADER,
  REQUEST_ID_HEADER,
  mintAuthProof,
} from '../src/lib/auth-proof';
import { requireAuthProof } from '../src/lib/auth-proof-require';

import type { NextRequest } from 'next/server';

const KEY = 'tier17-test-key-not-for-production';

interface MakeRequestOpts {
  readonly headers: Record<string, string>;
}

function makeReq(opts: MakeRequestOpts): NextRequest {
  const headers = new Headers(opts.headers);
  return {
    headers,
  } as unknown as NextRequest;
}

async function makeProofHeaders(input: {
  actor: string;
  username?: string;
  rolesRealm: string[];
  rolesResource: string[];
  tsMs?: number;
}): Promise<Record<string, string>> {
  const tsMs = input.tsMs ?? Date.now();
  const requestId = 'req-id-test-1234';
  const proof = await mintAuthProof(
    {
      actor: input.actor,
      username: input.username ?? null,
      rolesRealm: input.rolesRealm,
      rolesResource: input.rolesResource,
      requestId,
      timestampMs: tsMs,
    },
    KEY,
  );
  const headers: Record<string, string> = {
    'x-vigil-user': input.actor,
    [AUTH_PROOF_HEADER]: proof,
    [AUTH_PROOF_TS_HEADER]: String(tsMs),
    [REQUEST_ID_HEADER]: requestId,
  };
  if (input.username !== undefined) headers['x-vigil-username'] = input.username;
  if (input.rolesRealm.length > 0) headers['x-vigil-roles-realm'] = input.rolesRealm.join(',');
  if (input.rolesResource.length > 0)
    headers['x-vigil-roles-resource'] = input.rolesResource.join(',');
  // Legacy merged header — back-compat for routes that read it
  // directly. The proof itself does not bind this header (only realm
  // + resource split are signed), but routes that read both observe
  // consistent state.
  const merged = [...new Set([...input.rolesRealm, ...input.rolesResource])];
  if (merged.length > 0) headers['x-vigil-roles'] = merged.join(',');
  return headers;
}

describe('requireAuthProof — production-like (signing key set)', () => {
  beforeEach(() => {
    process.env.VIGIL_AUTH_PROOF_KEY = KEY;
    process.env.NODE_ENV = 'production';
  });
  afterEach(() => {
    delete process.env.VIGIL_AUTH_PROOF_KEY;
    process.env.NODE_ENV = 'test';
  });

  it('accepts a valid proof with matching role', async () => {
    const headers = await makeProofHeaders({
      actor: 'user-1',
      rolesRealm: ['operator'],
      rolesResource: [],
    });
    const res = await requireAuthProof(makeReq({ headers }), {
      allowedRoles: ['operator', 'architect'],
    });
    expect(res.ok).toBe(true);
    expect(res.actor).toBe('user-1');
    expect(res.roles).toContain('operator');
  });

  it('accepts a valid proof when the role is in the resource set (not realm)', async () => {
    const headers = await makeProofHeaders({
      actor: 'user-2',
      rolesRealm: [],
      rolesResource: ['operator'],
    });
    const res = await requireAuthProof(makeReq({ headers }), {
      allowedRoles: ['operator'],
    });
    expect(res.ok).toBe(true);
  });

  it('rejects a request with no proof header (401 missing-proof)', async () => {
    const res = await requireAuthProof(makeReq({ headers: { 'x-vigil-roles': 'operator' } }), {
      allowedRoles: ['operator'],
    });
    expect(res.ok).toBe(false);
    expect(res.response?.status).toBe(401);
    const body = (await res.response!.json()) as { error: string; reason: string };
    expect(body.error).toBe('auth-proof-invalid');
    expect(body.reason).toBe('missing-proof');
  });

  it('rejects a request with a forged role header (proof carries different roles)', async () => {
    // Proof binds rolesRealm=[civil_society]; attacker adds x-vigil-roles=operator.
    const headers = await makeProofHeaders({
      actor: 'attacker',
      rolesRealm: ['civil_society'],
      rolesResource: [],
    });
    headers['x-vigil-roles'] = 'civil_society,operator,architect';
    const res = await requireAuthProof(makeReq({ headers }), {
      allowedRoles: ['operator', 'architect'],
    });
    expect(res.ok).toBe(false);
    expect(res.response?.status).toBe(403);
    const body = (await res.response!.json()) as { error: string; reason: string };
    expect(body.error).toBe('forbidden');
    expect(body.reason).toBe('role-not-in-proof');
  });

  it('rejects a stale proof (timestamp > 5 min ago)', async () => {
    const headers = await makeProofHeaders({
      actor: 'user-3',
      rolesRealm: ['operator'],
      rolesResource: [],
      tsMs: Date.now() - 10 * 60 * 1000,
    });
    const res = await requireAuthProof(makeReq({ headers }), {
      allowedRoles: ['operator'],
    });
    expect(res.ok).toBe(false);
    expect(res.response?.status).toBe(401);
    const body = (await res.response!.json()) as { reason: string };
    expect(body.reason).toBe('stale');
  });

  it('rejects a proof with tampered roles header (HMAC mismatch)', async () => {
    const headers = await makeProofHeaders({
      actor: 'user-4',
      rolesRealm: ['civil_society'],
      rolesResource: [],
    });
    // Substitute the realm-roles header AFTER signing.
    headers['x-vigil-roles-realm'] = 'operator,architect';
    const res = await requireAuthProof(makeReq({ headers }), {
      allowedRoles: ['operator'],
    });
    expect(res.ok).toBe(false);
    expect(res.response?.status).toBe(401);
    const body = (await res.response!.json()) as { reason: string };
    expect(body.reason).toBe('mismatch');
  });

  it('rejects proof with valid signature but no matching role', async () => {
    const headers = await makeProofHeaders({
      actor: 'civ-only',
      rolesRealm: ['civil_society'],
      rolesResource: [],
    });
    const res = await requireAuthProof(makeReq({ headers }), {
      allowedRoles: ['operator', 'architect'],
    });
    expect(res.ok).toBe(false);
    expect(res.response?.status).toBe(403);
  });

  it('proof-only mode (no allowedRoles) accepts any verified caller', async () => {
    const headers = await makeProofHeaders({
      actor: 'any-user',
      rolesRealm: ['civil_society'],
      rolesResource: [],
    });
    const res = await requireAuthProof(makeReq({ headers }), {});
    expect(res.ok).toBe(true);
    expect(res.actor).toBe('any-user');
  });
});

describe('requireAuthProof — dev mode (no key)', () => {
  beforeEach(() => {
    delete process.env.VIGIL_AUTH_PROOF_KEY;
    process.env.NODE_ENV = 'development';
  });
  afterEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('falls back to legacy role-header check when allowed role is present', async () => {
    const res = await requireAuthProof(
      makeReq({
        headers: { 'x-vigil-roles': 'operator', 'x-vigil-user': 'dev-user' },
      }),
      { allowedRoles: ['operator'] },
    );
    expect(res.ok).toBe(true);
    expect(res.actor).toBe('dev-user');
  });

  it('legacy fallback rejects when role missing', async () => {
    const res = await requireAuthProof(makeReq({ headers: { 'x-vigil-roles': 'civil_society' } }), {
      allowedRoles: ['operator'],
    });
    expect(res.ok).toBe(false);
    expect(res.response?.status).toBe(403);
  });

  it('legacy fallback accepts proof-only mode (no role requirement)', async () => {
    const res = await requireAuthProof(makeReq({ headers: {} }), {});
    expect(res.ok).toBe(true);
  });
});

describe('requireAuthProof — production fail-closed on missing key', () => {
  beforeEach(() => {
    delete process.env.VIGIL_AUTH_PROOF_KEY;
    process.env.NODE_ENV = 'production';
  });
  afterEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('returns 503 misconfigured when key is unset in production', async () => {
    const res = await requireAuthProof(makeReq({ headers: { 'x-vigil-roles': 'operator' } }), {
      allowedRoles: ['operator'],
    });
    expect(res.ok).toBe(false);
    expect(res.response?.status).toBe(503);
    const body = (await res.response!.json()) as { error: string; reason: string };
    expect(body.error).toBe('auth-proof-misconfigured');
    expect(body.reason).toBe('missing-key');
  });
});
