/**
 * D5 — WebAuthn challenge → assertion verify path test.
 *
 * Exercises GET /api/council/vote/challenge end-to-end:
 *   - 403 when caller has neither council_member nor architect role
 *   - 400 on malformed query params
 *   - 403 when voter_address is not an active member
 *   - 409 when active member has no enrolled webauthn credential
 *   - 200 with {challenge, rpId, allowCredentials, expires_at} on success;
 *     persists exactly one webauthn_challenge row with TTL = 15 min
 *
 * The cryptographic assertion-verification side lives in
 * `/api/council/vote` (D5b shipped per DECISION-008); this test covers the
 * server-issued-challenge half of the contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const insertWebauthnChallenge = vi.fn(async (_row: Record<string, unknown>) => undefined);
const getActiveMemberByAddress = vi.fn(async (addr: string) => {
  if (addr === '0x' + 'a'.repeat(40)) {
    return { id: 'member-1', address: addr, webauthn_credential_id: 'cred-id-1' };
  }
  if (addr === '0x' + 'b'.repeat(40)) {
    // active member, no enrolled credential
    return { id: 'member-2', address: addr, webauthn_credential_id: null };
  }
  return null;
});

vi.mock('@vigil/db-postgres', () => ({
  getDb: async () => ({}),
  GovernanceRepo: class {
    getActiveMemberByAddress = getActiveMemberByAddress;
    insertWebauthnChallenge = insertWebauthnChallenge;
  },
}));

import { GET } from '../src/app/api/council/vote/challenge/route.js';

function makeReq(url: string, headers: Record<string, string> = {}) {
  return {
    url,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    nextUrl: new URL(url),
  } as unknown as Parameters<typeof GET>[0];
}

afterEach(() => vi.clearAllMocks());

describe('GET /api/council/vote/challenge — D5 WebAuthn challenge', () => {
  const happyUrl =
    'http://localhost/api/council/vote/challenge?proposal_id=11111111-1111-1111-1111-111111111111&voter_address=0x' +
    'a'.repeat(40);

  it('403 when caller has neither council_member nor architect role', async () => {
    const res = await GET(makeReq(happyUrl, { 'x-vigil-roles': 'operator' }));
    expect(res.status).toBe(403);
  });

  it('400 when proposal_id is not a UUID', async () => {
    const res = await GET(
      makeReq(
        'http://localhost/api/council/vote/challenge?proposal_id=not-a-uuid&voter_address=0x' +
          'a'.repeat(40),
        { 'x-vigil-roles': 'council_member' },
      ),
    );
    expect(res.status).toBe(400);
  });

  it('400 when voter_address is not 0x + 40 hex', async () => {
    const res = await GET(
      makeReq(
        'http://localhost/api/council/vote/challenge?proposal_id=11111111-1111-1111-1111-111111111111&voter_address=0xnothex',
        { 'x-vigil-roles': 'council_member' },
      ),
    );
    expect(res.status).toBe(400);
  });

  it('403 when voter_address is not an active council member', async () => {
    const res = await GET(
      makeReq(
        'http://localhost/api/council/vote/challenge?proposal_id=11111111-1111-1111-1111-111111111111&voter_address=0x' +
          'c'.repeat(40),
        { 'x-vigil-roles': 'council_member' },
      ),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('voter-not-active-member');
  });

  it('409 when an active member has no enrolled webauthn credential', async () => {
    const res = await GET(
      makeReq(
        'http://localhost/api/council/vote/challenge?proposal_id=11111111-1111-1111-1111-111111111111&voter_address=0x' +
          'b'.repeat(40),
        { 'x-vigil-roles': 'council_member' },
      ),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('webauthn-not-enrolled');
  });

  it('200 returns a base64url challenge + rpId + allowCredentials, persists one row with 15m TTL', async () => {
    const res = await GET(makeReq(happyUrl, { 'x-vigil-roles': 'council_member' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      challenge: string;
      rpId: string;
      allowCredentials: Array<{ type: string; id: string }>;
      timeout_ms: number;
      expires_at: string;
    };
    // base64url alphabet (no '+', '/', '=')
    expect(body.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32-byte challenge → ~43 base64url chars
    expect(body.challenge.length).toBeGreaterThanOrEqual(40);
    expect(body.allowCredentials).toHaveLength(1);
    expect(body.allowCredentials[0]!.id).toBe('cred-id-1');
    expect(body.allowCredentials[0]!.type).toBe('public-key');
    expect(body.timeout_ms).toBe(15 * 60 * 1000);

    expect(insertWebauthnChallenge).toHaveBeenCalledTimes(1);
    const row = insertWebauthnChallenge.mock.calls[0]![0] as {
      member_id: string;
      voter_address: string;
      proposal_id: string;
      challenge_b64u: string;
      issued_at: Date;
      expires_at: Date;
      consumed_at: Date | null;
    };
    expect(row.member_id).toBe('member-1');
    expect(row.voter_address).toBe('0x' + 'a'.repeat(40));
    expect(row.proposal_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(row.challenge_b64u).toBe(body.challenge);
    expect(row.consumed_at).toBeNull();
    // Issued + expires are 15 min apart.
    expect(row.expires_at.getTime() - row.issued_at.getTime()).toBe(15 * 60 * 1000);
  });

  it('issues a unique challenge on each call', async () => {
    const a = (await (
      await GET(makeReq(happyUrl, { 'x-vigil-roles': 'council_member' }))
    ).json()) as { challenge: string };
    const b = (await (
      await GET(makeReq(happyUrl, { 'x-vigil-roles': 'council_member' }))
    ).json()) as { challenge: string };
    expect(a.challenge).not.toBe(b.challenge);
  });

  it('architect role can issue a challenge for testing', async () => {
    const res = await GET(makeReq(happyUrl, { 'x-vigil-roles': 'architect' }));
    expect(res.status).toBe(200);
  });
});
