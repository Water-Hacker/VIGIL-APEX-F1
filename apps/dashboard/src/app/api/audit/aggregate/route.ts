import { UserActionEventRepo, getDb } from '@vigil/db-postgres';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * GET /api/audit/aggregate — TAL-PA aggregate counts (events per role per
 * category over a window). Public; no auth. Used by the
 * `/public/audit` dashboard tile.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl;
  const since =
    url.searchParams.get('since') ?? new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
  const until = url.searchParams.get('until') ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(since)) || Number.isNaN(Date.parse(until))) {
    return NextResponse.json({ error: 'invalid-time-bounds' }, { status: 400 });
  }
  const db = await getDb();
  const repo = new UserActionEventRepo(db);
  const rows = await repo.aggregateCounts({ sinceIso: since, untilIso: until });
  return NextResponse.json(
    { since, until, rows },
    {
      status: 200,
      headers: { 'Cache-Control': 'public, max-age=300' },
    },
  );
}
