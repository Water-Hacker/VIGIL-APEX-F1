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

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const parsed = Schemas.zTipSubmission.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid', details: parsed.error.issues }, { status: 400 });
    }

    // TODO Verify Turnstile token via Cloudflare API; rate-limit by fingerprint
    // (Caddy Layer-7 rate-limit handles raw IP burst).

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
    return NextResponse.json(
      { error: 'server-error', message: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
