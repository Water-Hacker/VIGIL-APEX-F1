/**
 * Block-E E.4 / D5 — WebAuthn → secp256k1 fallback E2E.
 *
 * Per W-10: VIGIL APEX has TWO paths for council-vote signing:
 *
 *   1. PRIMARY (post-M3): a small native desktop helper using
 *      libykcs11 to talk PKCS#11 directly to the operator's YubiKey.
 *      Produces a deterministic secp256k1 signature without going
 *      through the browser's WebAuthn ceremony.
 *
 *   2. FALLBACK: WebAuthn (FIDO2) — the browser presents an
 *      ES256K assertion (COSE alg -47) signed by the YubiKey;
 *      the platform extracts the (r,s) signature and pairs it
 *      with the recovery byte to construct a Polygon-valid tx
 *      signature. Documented in packages/security/src/fido.ts.
 *
 * The native libykcs11 helper is M3-M4 work. The WebAuthn
 * fallback is the path Phase-1 ships with. This test asserts:
 *
 *   (a) A council member with a registered WebAuthn credential
 *       can complete a vote end-to-end via the fallback path —
 *       no native helper required.
 *   (b) Every documented failure mode in POST /api/council/vote
 *       returns the correct status code + error string.
 *   (c) The WebAuthn ceremony does NOT depend on libykcs11 (the
 *       route's import graph contains zero references to
 *       PKCS#11 / libykcs11 — structural assertion).
 *
 * Boundary: the route's `verifyAuthentication` call is mocked so
 * we don't have to construct a valid CBOR-encoded WebAuthn
 * assertion (that requires real hardware-key signing or extensive
 * fixture-setup). The mock represents the "browser ceremony
 * succeeded; here is the verified result" boundary the production
 * code consumes.
 *
 * Refs: BLOCK-E-PLAN.md §2.4; W-10 (WebAuthn fallback path);
 * SRD §17.8.3 (secp256k1 signature extraction); SRD §22.5
 * (on-chain tx is authoritative; this is the off-chain mirror);
 * apps/dashboard/__tests__/council-vote-challenge.test.ts
 * (challenge half of the contract — complementary).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────
// Repo mock state — captured across tests so we can reset between cases
// ─────────────────────────────────────────────────────────────────

const VOTER_ADDRESS = '0x' + 'a1'.repeat(20);
const PROPOSAL_ID = '11111111-1111-1111-1111-111111111111';
const ONCHAIN_TX_HASH = '0x' + 'feed'.repeat(16);
const CHALLENGE_B64U = 'test-challenge-b64u-fixture-123';

const getActiveMemberByAddress = vi.fn();
const findOpenWebauthnChallenge = vi.fn();
const consumeWebauthnChallenge = vi.fn(async (_id: string) => undefined);
const bumpWebauthnCounter = vi.fn(async (_id: string, _newCounter: number) => undefined);
const getVote = vi.fn();
const getProposalById = vi.fn();
const insertVote = vi.fn(async (_row: Record<string, unknown>) => undefined);

vi.mock('@vigil/db-postgres', () => ({
  getDb: async () => ({}),
  GovernanceRepo: class {
    getActiveMemberByAddress = getActiveMemberByAddress;
    findOpenWebauthnChallenge = findOpenWebauthnChallenge;
    consumeWebauthnChallenge = consumeWebauthnChallenge;
    bumpWebauthnCounter = bumpWebauthnCounter;
    getVote = getVote;
    getProposalById = getProposalById;
    insertVote = insertVote;
  },
}));

// Mock @vigil/security's verifyAuthentication so we don't have to
// construct a real WebAuthn assertion. The production code's
// boundary consumption is `{verified: true, newCounter: number}`
// or thrown FidoVerificationError; the mock honours that contract.
const verifyAuthentication = vi.fn();
vi.mock('@vigil/security', () => ({
  verifyAuthentication: (opts: unknown) => verifyAuthentication(opts),
}));

import { POST } from '../src/app/api/council/vote/route.js';

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

interface VoteBody {
  proposal_id: string;
  choice: 'YES' | 'NO' | 'ABSTAIN' | 'RECUSE';
  webauthn_assertion: Record<string, unknown>;
  onchain_tx_hash: string;
  voter_address: string;
  voter_pillar: 'governance' | 'judicial' | 'civil_society' | 'audit' | 'technical';
  recuse_reason?: string;
}

function defaultVoteBody(overrides: Partial<VoteBody> = {}): VoteBody {
  return {
    proposal_id: PROPOSAL_ID,
    choice: 'YES',
    webauthn_assertion: {
      // Synthetic shape — verifyAuthentication is mocked so the
      // CBOR bytes don't have to be real. The route only forwards
      // this object to the mocked verifyAuthentication call.
      id: 'cred-id-1',
      response: {
        authenticatorData: 'aGVsbG8=',
        clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0=',
        signature: 'c2lnbmF0dXJl',
      },
      type: 'public-key',
    },
    onchain_tx_hash: ONCHAIN_TX_HASH,
    voter_address: VOTER_ADDRESS,
    voter_pillar: 'governance',
    ...overrides,
  };
}

function makeReq(body: unknown, headers: Record<string, string> = {}): Parameters<typeof POST>[0] {
  return {
    url: 'http://localhost/api/council/vote',
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    nextUrl: new URL('http://localhost/api/council/vote'),
  } as unknown as Parameters<typeof POST>[0];
}

const COUNCIL_HEADERS = {
  'x-vigil-user': 'user-council-1',
  'x-vigil-roles': 'council_member',
};

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    id: 'member-1',
    address: VOTER_ADDRESS,
    pillar: 'governance' as const,
    webauthn_credential_id: 'cred-id-1',
    webauthn_public_key: Buffer.from('mock-cose-public-key', 'utf8'),
    webauthn_counter: 5,
    ...overrides,
  };
}

beforeEach(() => {
  // Default happy-path mock returns; tests override per-case.
  getActiveMemberByAddress.mockResolvedValue(makeMember());
  findOpenWebauthnChallenge.mockResolvedValue({
    id: 'challenge-row-1',
    challenge_b64u: CHALLENGE_B64U,
  });
  verifyAuthentication.mockResolvedValue({ verified: true, newCounter: 6 });
  getVote.mockResolvedValue(null);
  getProposalById.mockResolvedValue({
    id: PROPOSAL_ID,
    on_chain_index: '42',
    state: 'open',
  });
  // Frozen origin env — required by parseAllowedWebauthnOrigins.
  process.env.WEBAUTHN_RP_ID = 'vigilapex.cm';
  process.env.WEBAUTHN_RP_ORIGIN = 'https://vigilapex.cm';
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('Block-E E.4 / D5 — WebAuthn fallback E2E (POST /api/council/vote)', () => {
  it('happy path — council member completes a vote via WebAuthn fallback', async () => {
    const res = await POST(makeReq(defaultVoteBody(), COUNCIL_HEADERS));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tx: string };
    expect(body.ok).toBe(true);
    expect(body.tx).toBe(ONCHAIN_TX_HASH);

    // verifyAuthentication called exactly once with the expected
    // ceremony shape — the mock proves the route reached the
    // verification step.
    expect(verifyAuthentication).toHaveBeenCalledTimes(1);
    const verifyCall = verifyAuthentication.mock.calls[0]![0] as {
      response: unknown;
      expectedChallenge: string;
      rp: { rpName: string; rpId: string; origin: string[] };
      credential: { credentialId: string; counter: number };
    };
    expect(verifyCall.expectedChallenge).toBe(CHALLENGE_B64U);
    expect(verifyCall.rp.rpId).toBe('vigilapex.cm');
    expect(verifyCall.rp.origin).toContain('https://vigilapex.cm');
    expect(verifyCall.credential.credentialId).toBe('cred-id-1');
    expect(verifyCall.credential.counter).toBe(5);

    // Challenge consumed (single-use) + counter bumped (clone
    // detection per the W3C WebAuthn §6.1.1 counter-replay defence).
    expect(consumeWebauthnChallenge).toHaveBeenCalledWith('challenge-row-1');
    expect(bumpWebauthnCounter).toHaveBeenCalledWith('member-1', 6);

    // Vote row inserted with the on-chain tx hash linked.
    expect(insertVote).toHaveBeenCalledTimes(1);
    const insertedVote = insertVote.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertedVote.proposal_id).toBe(PROPOSAL_ID);
    expect(insertedVote.voter_address).toBe(VOTER_ADDRESS);
    expect(insertedVote.choice).toBe('YES');
    expect(insertedVote.vote_tx_hash).toBe(ONCHAIN_TX_HASH);
    expect(insertedVote.recuse_reason).toBeNull();
  });

  it('counter NOT bumped when assertion counter equals stored counter (no clone signal)', async () => {
    verifyAuthentication.mockResolvedValueOnce({ verified: true, newCounter: 5 });
    const res = await POST(makeReq(defaultVoteBody(), COUNCIL_HEADERS));
    expect(res.status).toBe(200);
    expect(consumeWebauthnChallenge).toHaveBeenCalledTimes(1);
    expect(bumpWebauthnCounter).not.toHaveBeenCalled();
  });

  it('forbidden — caller has neither council_member nor architect role', async () => {
    const res = await POST(makeReq(defaultVoteBody(), { 'x-vigil-roles': 'operator' }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('forbidden');
    expect(verifyAuthentication).not.toHaveBeenCalled();
  });

  it('forbidden — no x-vigil-user header at all', async () => {
    const res = await POST(makeReq(defaultVoteBody(), { 'x-vigil-roles': 'council_member' }));
    expect(res.status).toBe(403);
  });

  it('architect role can also vote (admin override per SRD §22.5)', async () => {
    const res = await POST(
      makeReq(defaultVoteBody(), {
        'x-vigil-user': 'user-architect',
        'x-vigil-roles': 'architect',
      }),
    );
    expect(res.status).toBe(200);
  });

  it('400 — invalid body (malformed UUID)', async () => {
    const res = await POST(
      makeReq(defaultVoteBody({ proposal_id: 'not-a-uuid' }), COUNCIL_HEADERS),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe('invalid');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('400 — invalid choice enum', async () => {
    const res = await POST(
      makeReq({ ...defaultVoteBody(), choice: 'MAYBE' } as unknown as VoteBody, COUNCIL_HEADERS),
    );
    expect(res.status).toBe(400);
  });

  it('400 — malformed onchain_tx_hash (not 0x + 64 hex)', async () => {
    const res = await POST(
      makeReq(defaultVoteBody({ onchain_tx_hash: '0xshort' }), COUNCIL_HEADERS),
    );
    expect(res.status).toBe(400);
  });

  it('403 — voter_address is not an active council member', async () => {
    getActiveMemberByAddress.mockResolvedValueOnce(null);
    const res = await POST(makeReq(defaultVoteBody(), COUNCIL_HEADERS));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('voter-not-active-member');
  });

  it('403 — pillar/address mismatch (compromised session attempts wrong pillar)', async () => {
    getActiveMemberByAddress.mockResolvedValueOnce(makeMember({ pillar: 'audit' }));
    const res = await POST(
      makeReq(defaultVoteBody({ voter_pillar: 'governance' }), COUNCIL_HEADERS),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('pillar-address-mismatch');
  });

  it('409 — member has not enrolled a WebAuthn credential', async () => {
    getActiveMemberByAddress.mockResolvedValueOnce(
      makeMember({ webauthn_credential_id: null, webauthn_public_key: null }),
    );
    const res = await POST(makeReq(defaultVoteBody(), COUNCIL_HEADERS));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('webauthn-not-enrolled');
  });

  it('409 — no open challenge for this proposal+voter (must request fresh)', async () => {
    findOpenWebauthnChallenge.mockResolvedValueOnce(null);
    const res = await POST(makeReq(defaultVoteBody(), COUNCIL_HEADERS));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('no-open-challenge');
  });

  it('500 — WEBAUTHN_RP_ORIGIN misconfigured (unparseable URL)', async () => {
    // parseAllowedWebauthnOrigins throws InvalidWebauthnOriginError only
    // when an entry fails new URL(...) parsing — a syntactically broken
    // env var, not a wrong-but-parseable origin (which would just
    // produce an origin-mismatch at verifyAuthentication time, surfaced
    // as 401 webauthn-verify-failed instead).
    process.env.WEBAUTHN_RP_ORIGIN = ':::not-a-url:::';
    const res = await POST(makeReq(defaultVoteBody(), COUNCIL_HEADERS));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('webauthn-origin-misconfigured');
  });

  it('401 — WebAuthn verification fails (signature invalid / counter regression / origin mismatch)', async () => {
    verifyAuthentication.mockRejectedValueOnce(new Error('signature does not verify'));
    const res = await POST(makeReq(defaultVoteBody(), COUNCIL_HEADERS));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe('webauthn-verify-failed');
    expect(body.detail).toContain('signature does not verify');
    // Vote NOT inserted, counter NOT bumped, challenge NOT consumed
    // — failure path must not commit state.
    expect(insertVote).not.toHaveBeenCalled();
    expect(bumpWebauthnCounter).not.toHaveBeenCalled();
    expect(consumeWebauthnChallenge).not.toHaveBeenCalled();
  });

  it('409 — duplicate vote (same proposal+address already has a row)', async () => {
    getVote.mockResolvedValueOnce({
      id: 'existing-vote',
      proposal_id: PROPOSAL_ID,
      voter_address: VOTER_ADDRESS,
      choice: 'NO',
    });
    const res = await POST(makeReq(defaultVoteBody(), COUNCIL_HEADERS));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('duplicate-vote');
    expect(insertVote).not.toHaveBeenCalled();
  });

  it('404 — unknown proposal', async () => {
    getProposalById.mockResolvedValueOnce(null);
    const res = await POST(makeReq(defaultVoteBody(), COUNCIL_HEADERS));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unknown-proposal');
    expect(insertVote).not.toHaveBeenCalled();
  });

  it('RECUSE vote with reason — reason persisted', async () => {
    const res = await POST(
      makeReq(
        defaultVoteBody({ choice: 'RECUSE', recuse_reason: 'Conflict of interest: family ties' }),
        COUNCIL_HEADERS,
      ),
    );
    expect(res.status).toBe(200);
    const insertedVote = insertVote.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertedVote.choice).toBe('RECUSE');
    expect(insertedVote.recuse_reason).toBe('Conflict of interest: family ties');
  });
});

// ─────────────────────────────────────────────────────────────────
// Structural assertion: WebAuthn fallback does NOT depend on libykcs11
// ─────────────────────────────────────────────────────────────────

describe('Block-E E.4 / D5 — fallback path is libykcs11-independent (W-10)', () => {
  const REPO_ROOT = join(__dirname, '..', '..', '..');
  const ROUTE_TS = readFileSync(
    join(REPO_ROOT, 'apps/dashboard/src/app/api/council/vote/route.ts'),
    'utf8',
  );
  const FIDO_TS = readFileSync(join(REPO_ROOT, 'packages/security/src/fido.ts'), 'utf8');
  const VOTE_CEREMONY_TSX = readFileSync(
    join(REPO_ROOT, 'apps/dashboard/src/app/council/proposals/[id]/vote-ceremony.tsx'),
    'utf8',
  );

  // Strip line + block comments so we only assert against actual source —
  // both fido.ts and vote-ceremony.tsx mention libykcs11 in doc comments
  // (the W-10 fallback rationale), and that's expected. We're proving
  // there is no runtime IMPORT, not that the word never appears.
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('vote API route has no import of libykcs11 / pkcs11 modules', () => {
    const code = stripComments(ROUTE_TS);
    expect(code).not.toMatch(/from\s+['"][^'"]*libykcs11[^'"]*['"]/);
    expect(code).not.toMatch(/from\s+['"][^'"]*pkcs11[^'"]*['"]/i);
    expect(code).not.toMatch(/require\(['"][^'"]*(?:libykcs11|pkcs11)[^'"]*['"]\)/i);
  });

  it('@vigil/security FIDO module has no import of libykcs11', () => {
    const code = stripComments(FIDO_TS);
    expect(code).not.toMatch(/from\s+['"][^'"]*libykcs11[^'"]*['"]/);
    expect(code).not.toMatch(/from\s+['"][^'"]*pkcs11[^'"]*['"]/i);
    expect(code).not.toMatch(/require\(['"][^'"]*(?:libykcs11|pkcs11)[^'"]*['"]\)/i);
  });

  it('FIDO module advertises secp256k1 (ES256K, COSE alg -47) in supportedAlgorithmIDs', () => {
    // Per W-10, the WebAuthn fallback path produces an ES256K
    // assertion that the platform extracts (r,s) from to construct
    // the Polygon-valid secp256k1 signature. The supportedAlgorithmIDs
    // array MUST include -47 to advertise ES256K to the browser.
    expect(FIDO_TS).toMatch(/supportedAlgorithmIDs:.*-47/);
  });

  it('vote-ceremony page documents the W-10 fallback explicitly', () => {
    expect(VOTE_CEREMONY_TSX).toMatch(/W-10/);
    expect(VOTE_CEREMONY_TSX).toMatch(/vigil-polygon-signer/);
  });
});
