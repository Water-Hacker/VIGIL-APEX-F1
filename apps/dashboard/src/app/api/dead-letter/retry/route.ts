import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { incrementRetry, markResolved } from '../../../../lib/dead-letter.server';

export const dynamic = 'force-dynamic';

const zBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(['retry', 'resolve']),
  reason: z.string().max(500).optional(),
});

/**
 * POST /api/dead-letter/retry
 *
 * Operator-only. For each id either:
 *   - retry: bump retry_count + last_attempt; the worker poller picks
 *     it up on the next sweep (workers query last_attempt < NOW() - 5m).
 *   - resolve: stamp resolved_at + resolved_reason so it stops appearing
 *     in the unresolved list.
 *
 * The actual republish to the right Redis stream lives in
 * worker-adapter-repair (separate worker). This endpoint only flips the
 * row state — it intentionally does not stuff the message into Redis
 * itself, because that would couple the dashboard to the queue layout.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const roles = (req.headers.get('x-vigil-roles') ?? '').split(',').filter(Boolean);
  if (!(roles.includes('operator') || roles.includes('architect'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const parsed = zBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  }

  if (parsed.data.action === 'resolve') {
    const reason = parsed.data.reason ?? 'manual-resolve';
    await Promise.all(parsed.data.ids.map((id) => markResolved(id, reason)));
  } else {
    await Promise.all(parsed.data.ids.map((id) => incrementRetry(id)));
  }

  return NextResponse.json({ ok: true, count: parsed.data.ids.length });
}
