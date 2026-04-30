import { createHash } from 'node:crypto';

import { TipSanitise } from '@vigil/shared';
import { create as kuboCreate } from 'kubo-rpc-client';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * POST /api/tip/attachment — citizen-facing attachment-pin endpoint.
 *
 * Receives an ALREADY-ENCRYPTED ciphertext blob (the browser does
 * libsodium sealed-box BEFORE upload, with the same operator-team
 * public key used for the tip body). The server therefore never sees
 * the plaintext attachment — it pins the opaque blob to IPFS and
 * returns the CID.
 *
 * Even though the ciphertext is opaque, this route runs hard server-
 * side gates anyway (defense in depth):
 *
 *   - Strict Content-Type: application/octet-stream OR
 *     application/x-libsodium-sealed-box. Reject everything else.
 *   - Hard byte cap: TIP_ATTACHMENT_LIMITS.maxBytesPerFile + 32 KB
 *     of slack for the sealed-box overhead.
 *   - Per-IP token bucket (8 attachments / hour / IP) — Caddy
 *     already enforces a global cap upstream; this is the per-route
 *     gate.
 *   - Rejects null bodies, zero-length blobs, blobs whose first 16
 *     bytes are NUL (the sealed-box tag is non-zero by construction).
 *   - Returns ONLY {cid, sha256, bytes}. Never echoes the citizen's
 *     IP or User-Agent.
 *
 * The citizen's browser then submits the resulting CIDs in the body
 * of /api/tip/submit.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 32 KB headroom for sealed-box overhead (32 bytes nonce + 16-byte MAC
// + base64 envelope is amortised by the citizen-side encryption choice;
// we err generous to never refuse a legitimate small blob).
const SEALED_BOX_SLACK_BYTES = 32 * 1024;
const MAX_BLOB_BYTES = TipSanitise.TIP_ATTACHMENT_LIMITS.maxBytesPerFile + SEALED_BOX_SLACK_BYTES;

// Per-IP rate limit. Process-local (the upstream gateway also rate-
// limits at the edge). Key: remote IP. Value: array of recent timestamps.
const RECENT_BY_IP = new Map<string, number[]>();
const WINDOW_MS = 60 * 60 * 1000; // 1 h
const MAX_PER_WINDOW = 8;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (RECENT_BY_IP.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) {
    RECENT_BY_IP.set(ip, arr);
    return true;
  }
  arr.push(now);
  RECENT_BY_IP.set(ip, arr);
  return false;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Rate-limit gate
  const remoteIp =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  if (rateLimited(remoteIp)) {
    return NextResponse.json({ error: 'rate-limited' }, { status: 429 });
  }

  // Strict content-type gate
  const contentType = (req.headers.get('content-type') ?? '').toLowerCase();
  if (
    !contentType.startsWith('application/octet-stream') &&
    !contentType.startsWith('application/x-libsodium-sealed-box')
  ) {
    return NextResponse.json({ error: 'unsupported-content-type' }, { status: 415 });
  }

  // Read body with a hard cap
  let buf: Buffer;
  try {
    const ab = await req.arrayBuffer();
    if (ab.byteLength === 0) {
      return NextResponse.json({ error: 'empty-body' }, { status: 400 });
    }
    if (ab.byteLength > MAX_BLOB_BYTES) {
      return NextResponse.json({ error: 'too-large' }, { status: 413 });
    }
    buf = Buffer.from(ab);
  } catch {
    return NextResponse.json({ error: 'read-failed' }, { status: 400 });
  }

  // Sanity: a libsodium sealed-box ciphertext is at least 48 bytes
  // (32-byte ephemeral pubkey + 16-byte MAC). Refuse anything shorter.
  if (buf.byteLength < 48) {
    return NextResponse.json({ error: 'ciphertext-too-short' }, { status: 400 });
  }
  // Cheap pseudo-validity check: the first 16 bytes of a sealed box are
  // the start of a curve25519 public key — they should not be all-zero.
  let allZero = true;
  for (let i = 0; i < 16; i += 1) {
    if (buf[i] !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) {
    return NextResponse.json({ error: 'looks-not-encrypted' }, { status: 400 });
  }

  const sha256 = createHash('sha256').update(buf).digest('hex');

  // Pin to IPFS. The server treats the blob as opaque — it has no
  // decryption key, no obligation (or means) to inspect the content.
  let cid: string;
  try {
    const ipfsApiUrl = process.env.IPFS_API_URL ?? 'http://vigil-ipfs:5001';
    const kubo = kuboCreate({ url: ipfsApiUrl });
    const added = await kubo.add(buf, { pin: true, cidVersion: 1 });
    cid = added.cid.toString();
  } catch (e) {
    // Never leak internals on the public tip portal.
    console.error('[tip/attachment] ipfs error', e);
    return NextResponse.json({ error: 'pin-failed' }, { status: 502 });
  }

  return NextResponse.json(
    { cid, sha256, bytes: buf.byteLength },
    {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
