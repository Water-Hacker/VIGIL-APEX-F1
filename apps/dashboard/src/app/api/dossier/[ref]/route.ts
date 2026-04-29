import { HashChain } from '@vigil/audit-chain';
import { DossierRepo, getDb, getPool } from '@vigil/db-postgres';
import { create as kuboCreate } from 'kubo-rpc-client';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * GET /api/dossier/[ref]?lang=fr|en
 *
 * Operator-/auditor-/architect-only download endpoint for the bilingual
 * signed PDF dossier. The PDF is fetched from the local IPFS node by CID
 * and streamed back as application/pdf. SRD §27 / W-15 compliance is
 * preserved by the middleware (operator/auditor/architect roles only —
 * civil society / public never reach this route).
 *
 * Side-effects:
 *   - emits a `dossier.downloaded` audit row on success.
 *
 * Status codes:
 *   200 — bytes streamed
 *   400 — invalid lang param
 *   401 — handled by middleware
 *   403 — handled by middleware
 *   404 — no such dossier ref/lang in DB
 *   410 — dossier not yet signed (pre-Phase-1 dev fallback or in retry)
 *   503 — IPFS retrieval failed
 */
export const dynamic = 'force-dynamic';

const REF_RE = /^VA-\d{4}-\d{4,6}$/;

export async function GET(
  req: NextRequest,
  ctx: { params: { ref: string } },
): Promise<NextResponse | Response> {
  const ref = ctx.params.ref;
  if (!REF_RE.test(ref)) {
    return NextResponse.json({ error: 'invalid-ref' }, { status: 400 });
  }
  const lang = req.nextUrl.searchParams.get('lang');
  if (lang !== 'fr' && lang !== 'en') {
    return NextResponse.json({ error: 'invalid-lang' }, { status: 400 });
  }

  const db = await getDb();
  const repo = new DossierRepo(db);
  const row = await repo.getByRef(ref, lang);
  if (!row) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  if (row.pdf_cid === null || row.pdf_cid === '') {
    return NextResponse.json({ error: 'not-pinned' }, { status: 410 });
  }
  // Refuse to serve dossiers that never reached `signed` status (and aren't
  // explicitly opted into the dev fallback). Production dossiers are always
  // signed before download is exposed.
  const allowedStatuses: ReadonlyArray<string> = ['signed', 'pinned', 'delivered', 'acknowledged'];
  if (!allowedStatuses.includes(row.status)) {
    return NextResponse.json({ error: 'not-signed', status: row.status }, { status: 410 });
  }

  const ipfsApiUrl = process.env.IPFS_API_URL ?? 'http://vigil-ipfs:5001';
  const kubo = kuboCreate({ url: ipfsApiUrl });

  let bytes: Buffer;
  try {
    const chunks: Uint8Array[] = [];
    for await (const chunk of kubo.cat(row.pdf_cid)) chunks.push(chunk);
    bytes = Buffer.concat(chunks);
  } catch (err) {
    return NextResponse.json(
      { error: 'ipfs-fetch-failed', message: String(err) },
      { status: 503 },
    );
  }

  // Best-effort audit row. The download happens regardless of audit success;
  // an audit row failure should be observable in logs but not block the
  // operator. Pool is reused via getPool(); HashChain.append() is
  // idempotent on dedup key (audit_event_id is fresh per call).
  try {
    const pool = await getPool();
    const chain = new HashChain(pool);
    const operator = req.headers.get('x-vigil-username') ?? 'unknown';
    const ip =
      req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
    await chain.append({
      action: 'dossier.downloaded',
      actor: operator,
      subject_kind: 'dossier',
      subject_id: row.id,
      payload: { ref, lang, ip, sha256: row.pdf_sha256 },
    });
  } catch (err) {
    // Don't block download on audit failure.
    console.error('audit-emit-failed', err);
  }

  // Wrap Node Buffer in a Uint8Array view for Response (Web BodyInit
  // doesn't accept Buffer directly under TS DOM types).
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="${ref}-${lang}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Dossier-Status': row.status,
      'X-Dossier-Recipient': row.recipient_body_name,
      'X-Dossier-Sha256': row.pdf_sha256,
    },
  });
}
