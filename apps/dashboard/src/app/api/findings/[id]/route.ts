import { NextResponse, type NextRequest } from 'next/server';

import { getFindingDetail } from '../../../../lib/findings.server.js';

export const dynamic = 'force-dynamic';

const OPERATOR_ROLES = new Set(['operator', 'auditor', 'architect']);

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  // Middleware already gates /api/findings on operator/auditor/architect.
  // Re-check in-route so the operator-only payload (entity names, RCCM,
  // counter-evidence — W-15 surface) is never returned if middleware is
  // bypassed by misconfiguration.
  const roles = (req.headers.get('x-vigil-roles') ?? '').split(',').filter(Boolean);
  if (!roles.some((r) => OPERATOR_ROLES.has(r))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const detail = await getFindingDetail(params.id);
  if (!detail) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  return NextResponse.json(detail);
}
