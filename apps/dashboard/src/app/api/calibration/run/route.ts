import { QueueClient, STREAMS, newEnvelope } from '@vigil/queue';
import { NextResponse, type NextRequest } from 'next/server';

import { requireAuthProof } from '../../../../lib/auth-proof-require';

export const dynamic = 'force-dynamic';

let cachedQueue: QueueClient | null = null;
function queue(): QueueClient {
  if (!cachedQueue) cachedQueue = new QueueClient();
  return cachedQueue;
}

/**
 * POST /api/calibration/run — operator-only trigger that enqueues a
 * fresh calibration pass on the calibration worker. Idempotent: dedup
 * key is `calibration|now`, so spamming the button does not multiply
 * passes.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Tier-34 audit closure: verify the middleware-minted auth-proof HMAC
  // instead of trusting the spoofable `x-vigil-roles` header. Matches
  // the T17 closure pattern.
  const auth = await requireAuthProof(req, { allowedRoles: ['operator', 'architect'] });
  if (!auth.ok) return auth.response!;

  await queue().publish(
    STREAMS.CALIBRATION_RUN,
    newEnvelope(
      'dashboard',
      { triggered_by: auth.actor ?? req.headers.get('x-vigil-username') ?? 'unknown' },
      'calibration|now',
      req.headers.get('x-vigil-request-id') ?? undefined,
    ),
  );
  return NextResponse.json({ ok: true });
}
