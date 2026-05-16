import { NextResponse } from 'next/server';

/**
 * GET /api/tip/public-key — operator-team libsodium box public key.
 *
 * Read once at startup from Vault and cached. Rotated periodically; the
 * dashboard refreshes the in-memory key on SIGHUP.
 *
 * Defence-in-depth: this endpoint is the citizen-trust anchor. A
 * misconfigured Vault that returns a non-curve25519 string would
 * silently cause every submitted tip to be encrypted to a key the
 * operator-team cannot decrypt — the tips would survive as ciphertext
 * forever with no recovery path. We therefore validate the key shape
 * (canonical base64 of exactly 32 bytes) before serving and return
 * 503 if the shape is wrong, so the misconfiguration surfaces at the
 * portal load rather than after thousands of unrecoverable tips.
 */
export const dynamic = 'force-dynamic';

const CURVE25519_PUBKEY_BYTES = 32;
const CANONICAL_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function isValidCurve25519Pubkey(s: string): boolean {
  if (!CANONICAL_BASE64.test(s)) return false;
  if (s.length % 4 !== 0) return false;
  // Base64 of 32 bytes is exactly 44 characters including padding.
  if (s.length !== 44) return false;
  try {
    return Buffer.from(s, 'base64').byteLength === CURVE25519_PUBKEY_BYTES;
  } catch {
    return false;
  }
}

export function GET(): NextResponse {
  const pk = process.env.TIP_OPERATOR_TEAM_PUBKEY;
  if (!pk || pk.startsWith('PLACEHOLDER')) {
    return NextResponse.json({ error: 'tip-portal-not-yet-provisioned' }, { status: 503 });
  }
  if (!isValidCurve25519Pubkey(pk)) {
    // Misconfigured Vault → garbage key. Refusing to serve forces the
    // operator to fix Vault before any tip is encrypted-to-nowhere.
    console.error('[tip/public-key] TIP_OPERATOR_TEAM_PUBKEY is not a valid curve25519 pubkey');
    return NextResponse.json({ error: 'tip-portal-pubkey-malformed' }, { status: 503 });
  }
  return NextResponse.json(
    { publicKey: pk },
    {
      headers: {
        // Short browser cache so a rotation propagates within minutes;
        // never let an intermediary cache an old key for hours.
        'Cache-Control': 'public, max-age=60, must-revalidate',
      },
    },
  );
}
