import { DossierRepo, getDb } from '@vigil/db-postgres';
import { createLogger } from '@vigil/observability';
import { create as kuboCreate } from 'kubo-rpc-client';
import { NextResponse, type NextRequest } from 'next/server';

import { audit, AuditEmitterUnavailableError } from '@/lib/audit-emit.server';

const logger = createLogger({ service: 'api-dossier' });

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

  // TAL-PA — emit BEFORE the work; halt-on-failure refuses the download
  // if the audit emitter is unavailable (doctrine §"No dark periods").
  try {
    return await audit(
      req,
      {
        eventType: 'dossier.downloaded',
        targetResource: `dossier:${ref}:${lang}`,
        actionPayload: { ref, lang, sha256: row.pdf_sha256, dossier_id: row.id },
      },
      async () => {
        let bytes: Buffer;
        try {
          const chunks: Uint8Array[] = [];
          for await (const chunk of kubo.cat(row.pdf_cid!)) chunks.push(chunk);
          bytes = Buffer.concat(chunks);
        } catch (err) {
          // Mode 4.9: do NOT echo `err`/`err.stack`/`err.message` to the
          // client. Internal IPFS state (paths, peer IDs, daemon
          // version) leaks via the stack trace and aids reconnaissance.
          // Log the full error server-side so operators can diagnose;
          // return only a generic message to the caller.
          // Tier-64 log-convention sweep: structured errName/errMsg.
          const e = err instanceof Error ? err : new Error(String(err));
          logger.error(
            { errName: e.name, errMsg: e.message, ref, lang, cid: row.pdf_cid },
            'ipfs-fetch-failed',
          );
          return NextResponse.json({ error: 'ipfs-fetch-failed' }, { status: 503 });
        }
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
      },
    );
  } catch (err) {
    if (err instanceof AuditEmitterUnavailableError) {
      // Mode 4.9: log server-side, return opaque code. The audit
      // emitter's message may contain internal Postgres / Vault state.
      // Tier-64 log-convention sweep: structured errName/errMsg.
      logger.error(
        { errName: err.name, errMsg: err.message, ref, lang },
        'audit-emitter-unavailable',
      );
      return NextResponse.json({ error: 'audit-emitter-unavailable' }, { status: 503 });
    }
    throw err;
  }
}
