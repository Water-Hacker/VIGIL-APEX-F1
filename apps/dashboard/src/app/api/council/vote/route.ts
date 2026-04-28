import { randomUUID } from 'node:crypto';

import { GovernanceRepo, getDb } from '@vigil/db-postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

/**
 * POST /api/council/vote
 *
 * Body:
 *   {
 *     proposal_id: uuid,
 *     choice: 'YES' | 'NO' | 'ABSTAIN' | 'RECUSE',
 *     webauthn_assertion: <FIDO2 assertion JSON>,
 *     onchain_tx_hash: 0x... (already broadcast by the client via vigil-polygon-signer),
 *     recuse_reason?: string
 *   }
 *
 * Per SRD §22.5 the on-chain vote IS the authoritative record; this
 * endpoint persists the off-chain mirror so the dashboard can display
 * tallies without a chain RPC round-trip per page load. The WebAuthn
 * assertion proves the authenticated browser session belongs to the
 * council member whose YubiKey signed the on-chain tx.
 */
export const dynamic = 'force-dynamic';

const zVote = z.object({
  proposal_id: z.string().uuid(),
  choice: z.enum(['YES', 'NO', 'ABSTAIN', 'RECUSE']),
  webauthn_assertion: z.unknown(),
  onchain_tx_hash: z.string().regex(/^0x[0-9a-f]{64}$/i),
  voter_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  voter_pillar: z.enum([
    'judicial',
    'civil_society',
    'academic',
    'technical',
    'religious',
  ]),
  recuse_reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Identity from middleware (C1) — server-only header injected after JWT verify.
  const userId = req.headers.get('x-vigil-user');
  const roles = (req.headers.get('x-vigil-roles') ?? '').split(',').filter(Boolean);
  if (!userId || !(roles.includes('council_member') || roles.includes('architect'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const parsed = zVote.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  }

  // TODO Phase C5b — verify the WebAuthn assertion against the council
  // member's enrolled credential (security/fido.ts). Skipped here so the
  // happy path stays self-contained; full verifier ships with C15a.
  void parsed.data.webauthn_assertion;

  const db = await getDb();
  const repo = new GovernanceRepo(db);

  const existing = await repo.getVote(parsed.data.proposal_id, parsed.data.voter_address);
  if (existing) {
    return NextResponse.json({ error: 'duplicate-vote' }, { status: 409 });
  }

  const proposal = await repo.getProposalById(parsed.data.proposal_id);
  if (!proposal) {
    return NextResponse.json({ error: 'unknown-proposal' }, { status: 404 });
  }

  await repo.insertVote({
    id: randomUUID(),
    proposal_id: parsed.data.proposal_id,
    voter_address: parsed.data.voter_address.toLowerCase(),
    voter_pillar: parsed.data.voter_pillar,
    choice: parsed.data.choice,
    cast_at: new Date(),
    vote_tx_hash: parsed.data.onchain_tx_hash,
    recuse_reason: parsed.data.recuse_reason ?? null,
  });

  return NextResponse.json({ ok: true, tx: parsed.data.onchain_tx_hash });
}
