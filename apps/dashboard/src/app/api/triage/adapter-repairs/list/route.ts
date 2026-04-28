import { NextResponse, type NextRequest } from 'next/server';

import { listPendingProposals } from '../../../../../lib/adapter-repair.server.js';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const roles = (req.headers.get('x-vigil-roles') ?? '').split(',').filter(Boolean);
  if (!(roles.includes('operator') || roles.includes('architect'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const rows = await listPendingProposals();
  return NextResponse.json({ proposals: rows });
}
