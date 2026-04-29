import { TipRepo, getDb } from '@vigil/db-postgres';
import { Schemas } from '@vigil/shared';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * POST /api/tip/submit — server-side persistence of an already-encrypted tip.
 *
 * Per SRD §28.4: this endpoint NEVER sees plaintext. It only accepts the
 * libsodium sealed-box ciphertext, the encrypted contact (optional), and
 * a Turnstile token for anti-bot.
 */
export const dynamic = 'force-dynamic';

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

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
async function verifyTurnstile(
  token: string,
  remoteIp: string | null,
): Promise<boolean> {
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const parsed = Schemas.zTipSubmission.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid', details: parsed.error.issues }, { status: 400 });
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
