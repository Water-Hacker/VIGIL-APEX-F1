import { randomBytes, randomUUID } from 'node:crypto';

import { GovernanceRepo, getDb } from '@vigil/db-postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

/**
 * GET /api/council/vote/challenge?proposal_id=<uuid>&voter_address=0x...
 *
 * Issues a fresh WebAuthn assertion challenge for the council member to sign
 * via their YubiKey. The challenge is persisted in
 * `governance.webauthn_challenge` (TTL 15 min) and consumed by the matching
 * POST /api/council/vote when the assertion is verified.
 *
 * Closes the C5b TODO: previously the vote endpoint accepted any
 * `webauthn_assertion` without binding it to a server-issued challenge.
 */
export const dynamic = 'force-dynamic';

const zQuery = z.object({
  proposal_id: z.string().uuid(),
  voter_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

const CHALLENGE_TTL_MS = 15 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const roles = (req.headers.get('x-vigil-roles') ?? '').split(',').filter(Boolean);
  if (!(roles.includes('council_member') || roles.includes('architect'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const parsed = zQuery.safeParse({
    proposal_id: url.searchParams.get('proposal_id'),
    voter_address: url.searchParams.get('voter_address'),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  }

  const db = await getDb();
  const repo = new GovernanceRepo(db);
  const voterAddress = parsed.data.voter_address.toLowerCase();

  const member = await repo.getActiveMemberByAddress(voterAddress);
  if (!member) {
    return NextResponse.json({ error: 'voter-not-active-member' }, { status: 403 });
  }
  if (!member.webauthn_credential_id) {
    return NextResponse.json(
      { error: 'webauthn-not-enrolled', detail: 'council member has no enrolled WebAuthn credential' },
      { status: 409 },
    );
  }

  const challenge = b64url(randomBytes(32));
  const now = new Date();
  await repo.insertWebauthnChallenge({
    id: randomUUID(),
    member_id: member.id,
    voter_address: voterAddress,
    proposal_id: parsed.data.proposal_id,
    challenge_b64u: challenge,
    issued_at: now,
    expires_at: new Date(now.getTime() + CHALLENGE_TTL_MS),
    consumed_at: null,
  });

  return NextResponse.json({
    challenge,
    rpId: process.env.WEBAUTHN_RP_ID ?? 'vigilapex.cm',
    allowCredentials: [
      {
        type: 'public-key',
        id: member.webauthn_credential_id,
      },
    ],
    timeout_ms: CHALLENGE_TTL_MS,
    expires_at: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
  });
}
