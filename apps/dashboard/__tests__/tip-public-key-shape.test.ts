/**
 * Tier-1 audit — tip-public-key route shape validation + cache policy.
 *
 * The /api/tip/public-key endpoint is the citizen-trust anchor. A
 * misconfigured Vault that returns a non-curve25519 string would
 * silently cause every submitted tip to be encrypted to a key the
 * operator-team cannot decrypt; the tips survive as ciphertext forever
 * with no recovery path.
 *
 * These tests pin:
 *   1. Reject empty / unset env var → 503 + opaque error.
 *   2. Reject PLACEHOLDER prefix → 503 + same opaque error.
 *   3. Reject canonical-base64 strings of wrong length → 503.
 *   4. Reject base64url (`-` / `_`) — we only emit canonical base64.
 *   5. Accept a valid 32-byte pubkey → 200, JSON body has `publicKey`,
 *      response carries Cache-Control: public, max-age=60, must-revalidate.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET } from '../src/app/api/tip/public-key/route';

const ORIGINAL = process.env.TIP_OPERATOR_TEAM_PUBKEY;

function setKey(v: string | undefined): void {
  if (v === undefined) delete process.env.TIP_OPERATOR_TEAM_PUBKEY;
  else process.env.TIP_OPERATOR_TEAM_PUBKEY = v;
}

describe('tip-public-key route shape validation', () => {
  beforeEach(() => {
    setKey(undefined);
  });
  afterEach(() => {
    setKey(ORIGINAL);
  });

  it('returns 503 when TIP_OPERATOR_TEAM_PUBKEY is unset', async () => {
    const res = GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('tip-portal-not-yet-provisioned');
  });

  it('returns 503 when the key is a PLACEHOLDER value', async () => {
    setKey('PLACEHOLDER_NOT_YET_PROVISIONED');
    const res = GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('tip-portal-not-yet-provisioned');
  });

  it('returns 503 with a distinct error when the key is canonical base64 but wrong length', async () => {
    // 24-char base64 = 18 bytes; not a curve25519 pubkey (32 bytes / 44 chars).
    setKey('abcdefghijklmnopqrstuvwx');
    const res = GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('tip-portal-pubkey-malformed');
  });

  it('returns 503 when the key uses base64url alphabet (`-`/`_`)', async () => {
    // 44 chars but contains `-` and `_` which are base64url, not canonical.
    setKey('abcdefghijklmnopqrstuvwxyz0123456789-ABCDEF_=');
    const res = GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('tip-portal-pubkey-malformed');
  });

  it('returns 503 when the key is canonical base64 of 31 bytes (off-by-one)', async () => {
    // 44 chars but decoded length is wrong because padding implies 31 bytes.
    setKey(Buffer.alloc(31, 0xab).toString('base64').padEnd(44, '='));
    const res = GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('tip-portal-pubkey-malformed');
  });

  it('returns 200 + Cache-Control when the key is a valid 32-byte canonical-base64 pubkey', async () => {
    const validKey = Buffer.alloc(32, 0xab).toString('base64');
    expect(validKey).toHaveLength(44);
    setKey(validKey);
    const res = GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publicKey?: string };
    expect(body.publicKey).toBe(validKey);
    // Short browser cache so rotation propagates within minutes; never
    // let an intermediary cache the key for hours.
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, must-revalidate');
  });
});
