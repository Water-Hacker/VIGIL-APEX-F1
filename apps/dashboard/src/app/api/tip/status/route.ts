import { TipRepo, getDb } from '@vigil/db-postgres';
import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tip/status?ref=TIP-YYYY-NNNN
 *
 * Public — submitter polls this endpoint with the tracking ref returned
 * at submission time. Per SRD §28.11 we return ONLY {ref, disposition,
 * received_at_date}. Never expose region, topic_hint, or any field that
 * could narrow down the submitter.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const ref = req.nextUrl.searchParams.get('ref');
  if (!ref || !/^TIP-\d{4}-\d{4,6}$/.test(ref)) {
    return NextResponse.json({ error: 'invalid-ref' }, { status: 400 });
  }
  const db = await getDb();
  const repo = new TipRepo(db);
  const tip = await repo.getByRef(ref);
  if (!tip) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  return NextResponse.json(
    {
      ref: tip.ref,
      disposition: tip.disposition,
      received_on: tip.received_at.toISOString().slice(0, 10),
    },
    {
      headers: {
        // Don't cache submitter-specific lookups
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
