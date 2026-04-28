import { TipRepo, getDb } from '@vigil/db-postgres';
import { QueueClient, STREAMS, newEnvelope } from '@vigil/queue';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

let cachedQueue: QueueClient | null = null;
function queue(): QueueClient {
  if (!cachedQueue) cachedQueue = new QueueClient();
  return cachedQueue;
}

const zBody = z.object({
  tip_id: z.string().uuid(),
  decryption_shares: z.array(z.string().min(8)).min(3).max(5),
});

/**
 * POST /api/triage/tips/decrypt — operator + tip_handler only.
 *
 * Forwards the tip ID and three council Shamir shares to
 * worker-tip-triage via the TIP_TRIAGE stream (A12). The worker performs
 * the GF(2^8) reconstruction in-memory, decrypts the sealed-box, runs
 * the paraphrase pass, and writes the paraphrase back to a Redis
 * response key keyed on tip_id. The dashboard then GETs that key.
 *
 * The shares never touch persistent storage at this layer — the envelope
 * goes straight to a non-persistent Redis stream, and worker-tip-triage
 * deletes them after combining.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const roles = (req.headers.get('x-vigil-roles') ?? '').split(',').filter(Boolean);
  if (!(roles.includes('tip_handler') || roles.includes('architect'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const parsed = zBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  }

  const db = await getDb();
  const repo = new TipRepo(db);
  const tip = await repo.getByRef(parsed.data.tip_id);
  if (!tip) return NextResponse.json({ error: 'unknown-tip' }, { status: 404 });

  const correlationId = req.headers.get('x-correlation-id') ?? undefined;
  await queue().publish(
    STREAMS.TIP_TRIAGE,
    newEnvelope(
      'dashboard',
      {
        tip_id: parsed.data.tip_id,
        decryption_shares: parsed.data.decryption_shares,
      },
      `tip|${parsed.data.tip_id}|decrypt`,
      correlationId,
    ),
  );

  // Phase C10b: poll Redis for the paraphrase response (worker-tip-triage
  // writes it under `triage:paraphrase:<tip_id>` with 60s TTL). For Phase
  // 1 we acknowledge the queueing only; the dashboard refreshes via SSE.
  return NextResponse.json({
    queued: true,
    tip_id: parsed.data.tip_id,
    note: 'Decryption queued. Subscribe to /api/realtime for completion.',
  });
}
