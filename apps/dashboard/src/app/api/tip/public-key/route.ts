import { NextResponse } from 'next/server';

/**
 * GET /api/tip/public-key — operator-team libsodium box public key.
 *
 * Read once at startup from Vault and cached. Rotated periodically; the
 * dashboard refreshes the in-memory key on SIGHUP.
 */
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  const pk = process.env.TIP_OPERATOR_TEAM_PUBKEY;
  if (!pk || pk.startsWith('PLACEHOLDER')) {
    return NextResponse.json(
      { error: 'tip-portal-not-yet-provisioned' },
      { status: 503 },
    );
  }
  return NextResponse.json({ publicKey: pk });
}
