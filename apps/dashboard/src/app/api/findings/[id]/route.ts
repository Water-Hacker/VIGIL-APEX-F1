import { NextResponse, type NextRequest } from 'next/server';

import { getFindingDetail } from '../../../../lib/findings.server.js';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const detail = await getFindingDetail(params.id);
  if (!detail) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  return NextResponse.json(detail);
}
