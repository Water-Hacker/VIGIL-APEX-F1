import { TipRepo, getDb } from '@vigil/db-postgres';
import { Schemas, TipSanitise } from '@vigil/shared';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * POST /api/tip/submit — server-side persistence of an already-encrypted tip.
 *
 * Per SRD §28.4: this endpoint NEVER sees plaintext. It only accepts the
 * libsodium sealed-box ciphertext, the encrypted contact (optional), and
 * a Turnstile token for anti-bot.
 */
export const dynamic = 'force-dynamic';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
  hostname?: string;
  action?: string;
}

/**
 * Verify a Cloudflare Turnstile token against the siteverify endpoint.
 * Returns true only on `success: true` from Cloudflare. The secret is
 * read from /run/secrets at request time so a hot-rotated key takes
 * effect on the very next request.
 */
async function verifyTurnstile(token: string, remoteIp: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Fail closed — never accept a tip when Turnstile is misconfigured.
    console.error('[tip/submit] TURNSTILE_SECRET_KEY not set; rejecting');
    return false;
  }
  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('response', token);
  if (remoteIp) params.set('remoteip', remoteIp);
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: params,
      // 8 s upper bound — the public form blocks until this resolves.
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as TurnstileVerifyResponse;
    if (!json.success) {
      console.warn('[tip/submit] turnstile rejected', json['error-codes']);
    }
    return json.success === true;
  } catch (e) {
    console.error('[tip/submit] turnstile verify error', e);
    return false;
  }
}

/**
 * Strict CID format gate. IPFS CIDv1 base32 starts with 'b' and is
 * 50–62 characters of [a-z2-7]. We pin our content via kubo with
 * `cidVersion: 1`, so the CIDs we issue match this regex; reject
 * anything else to prevent a citizen from injecting a long string
 * into the row.
 */
const CID_RE = /^b[a-z2-7]{50,62}$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Hard size cap on the JSON body (the schema also caps individual
    // fields, but a malformed request could still hand us megabytes
    // of nested JSON before parse). 256 KB is comfortably above the
    // legitimate ceiling (5 attachment CIDs + 20 KB body ciphertext).
    const ct = req.headers.get('content-type') ?? '';
    if (!ct.toLowerCase().startsWith('application/json')) {
      return NextResponse.json({ error: 'unsupported-content-type' }, { status: 415 });
    }
    const cl = Number(req.headers.get('content-length') ?? 0);
    if (cl > 256 * 1024) {
      return NextResponse.json({ error: 'payload-too-large' }, { status: 413 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const parsed = Schemas.zTipSubmission.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid', details: parsed.error.issues }, { status: 400 });
    }

    // DECISION-016 hardening: re-validate every server-trustable
    // bound the schema doesn't capture.
    if (parsed.data.attachment_cids.length > TipSanitise.TIP_ATTACHMENT_LIMITS.maxFiles) {
      return NextResponse.json({ error: 'too-many-attachments' }, { status: 400 });
    }
    for (const cid of parsed.data.attachment_cids) {
      if (!CID_RE.test(cid)) {
        return NextResponse.json({ error: 'malformed-cid' }, { status: 400 });
      }
    }
    // Reject if the base64 ciphertext fields contain anything outside
    // the canonical alphabet. zTipSubmission's max-length cap doesn't
    // pin the alphabet — a citizen who handcrafts a payload with a NUL
    // byte would otherwise sneak through.
    if (!isCanonicalBase64(parsed.data.body_ciphertext_b64)) {
      return NextResponse.json({ error: 'body-not-canonical-base64' }, { status: 400 });
    }
    if (
      parsed.data.contact_ciphertext_b64 &&
      !isCanonicalBase64(parsed.data.contact_ciphertext_b64)
    ) {
      return NextResponse.json({ error: 'contact-not-canonical-base64' }, { status: 400 });
    }
    // Sanity: a libsodium sealed-box ciphertext is at least 48 bytes →
    // at least 64 base64 chars. The schema's min(120) on the body
    // ciphertext already enforces this; pin the contact case too.
    if (
      parsed.data.contact_ciphertext_b64 !== undefined &&
      parsed.data.contact_ciphertext_b64.length < 64
    ) {
      return NextResponse.json({ error: 'contact-ciphertext-too-short' }, { status: 400 });
    }

    // Anti-bot gate (SRD §28.5). Caddy already enforces a 5/min/IP burst
    // limit upstream; this is the per-submission proof-of-human check.
    const remoteIp =
      req.headers.get('cf-connecting-ip') ??
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      null;
    const ok = await verifyTurnstile(parsed.data.turnstile_token, remoteIp);
    if (!ok) {
      return NextResponse.json({ error: 'turnstile-failed' }, { status: 403 });
    }

    const db = await getDb();
    const tipRepo = new TipRepo(db);
    const year = new Date().getUTCFullYear();
    const seq = await tipRepo.nextRefSeqForYear(year);
    const ref = `TIP-${year}-${String(seq).padStart(4, '0')}`;

    await tipRepo.insert({
      id: crypto.randomUUID(),
      ref,
      disposition: 'NEW',
      body_ciphertext: Buffer.from(parsed.data.body_ciphertext_b64, 'base64'),
      contact_ciphertext: parsed.data.contact_ciphertext_b64
        ? Buffer.from(parsed.data.contact_ciphertext_b64, 'base64')
        : null,
      attachment_cids: [...parsed.data.attachment_cids],
      topic_hint: parsed.data.topic_hint ?? null,
      region: parsed.data.region ?? null,
      received_at: new Date(),
      triaged_at: null,
      triaged_by: null,
      promoted_finding_id: null,
      triage_notes_ciphertext: null,
    });

    return NextResponse.json({ ref });
  } catch (e) {
    // Never leak internals on the public tip portal — the error message can
    // disclose schema, hostnames, or internal IPs to an adversarial submitter.
    console.error('[tip/submit] internal error', e);
    return NextResponse.json({ error: 'server-error' }, { status: 500 });
  }
}

/**
 * Strict canonical-base64 check. Canonical base64 is `[A-Za-z0-9+/]*`
 * with optional `=` padding (0–2 chars at the end), length divisible
 * by 4. We refuse base64url (`-` / `_`) on this surface because
 * libsodium emits canonical base64; a payload with non-canonical
 * chars came from a different encoder and is suspicious.
 */
function isCanonicalBase64(s: string): boolean {
  if (s.length === 0) return false;
  if (s.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}
