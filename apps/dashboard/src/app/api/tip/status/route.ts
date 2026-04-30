import { TipRepo, getDb } from '@vigil/db-postgres';
import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tip/status?ref=TIP-YYYY-NNNN
 *
 * Public — submitter polls with their tracking ref. DECISION-016
 * contract: returns a tamper-evident receipt the citizen can verify
 * locally against their own copy of the encrypted blob (their
 * browser kept it at submit time):
 *
 *   {
 *     ref, received_on,
 *     disposition,                     // closed enum
 *     body_ciphertext_sha256,          // 64-hex SHA-256 of stored ciphertext
 *     last_disposition_audit_event_id, // anchor in the audit chain
 *     body_intact                      // false iff REDACTED_BY_COURT_ORDER
 *   }
 *
 * SRD §28.11: never expose region, topic_hint, or any field that
 * narrows the submitter. The receipt is information-equivalent to
 * "your tip is in our system, unmodified, at this disposition,
 * anchored at this audit event".
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const ref = req.nextUrl.searchParams.get('ref');
  if (!ref || !/^TIP-\d{4}-\d{4,6}$/.test(ref)) {
    return NextResponse.json({ error: 'invalid-ref' }, { status: 400 });
  }
  const db = await getDb();
  const repo = new TipRepo(db);
  const receipt = await repo.buildReceipt(ref);
  if (!receipt) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  return NextResponse.json(
    {
      ref: receipt.ref,
      received_on: receipt.received_at.slice(0, 10),
      disposition: receipt.disposition,
      body_ciphertext_sha256: receipt.body_ciphertext_sha256,
      last_disposition_audit_event_id: receipt.last_disposition_audit_event_id,
      body_intact: receipt.body_intact,
    },
    {
      headers: {
        // Submitter-specific lookups must never be cached.
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
