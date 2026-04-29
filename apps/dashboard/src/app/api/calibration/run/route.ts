import { QueueClient, STREAMS, newEnvelope } from '@vigil/queue';
import { NextResponse, type NextRequest } from 'next/server';


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
  const roles = (req.headers.get('x-vigil-roles') ?? '').split(',').filter(Boolean);
  if (!(roles.includes('operator') || roles.includes('architect'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await queue().publish(
    STREAMS.CALIBRATION_RUN,
    newEnvelope(
      'dashboard',
      { triggered_by: req.headers.get('x-vigil-username') ?? 'unknown' },
      'calibration|now',
      req.headers.get('x-correlation-id') ?? undefined,
    ),
  );
  return NextResponse.json({ ok: true });
}
