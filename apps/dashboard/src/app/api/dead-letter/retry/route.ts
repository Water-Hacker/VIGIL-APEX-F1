import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAuthProof } from '../../../../lib/auth-proof-require';
import { batchDeadLetterUpdate, DeadLetterNotFoundError } from '../../../../lib/dead-letter.server';

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
  // Tier-17 audit closure: verify the middleware-minted auth-proof HMAC,
  // not just the spoofable `x-vigil-roles` header.
  const auth = await requireAuthProof(req, { allowedRoles: ['operator', 'architect'] });
  if (!auth.ok) return auth.response!;

  const parsed = zBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  }

  // AUDIT-004: atomic multi-row UPDATE. Single SQL means partial-failure
  // is impossible — either the entire batch lands or the entire batch
  // rolls back at the database level.
  // AUDIT-005: zero affected rows -> typed DeadLetterNotFoundError ->
  // HTTP 404 (instead of 200 with count: 0). Partial matches return 200
  // but include `requested - count` in the response so the operator UI
  // can flag stale ids.
  let result: { affected: ReadonlyArray<string> };
  try {
    result = await batchDeadLetterUpdate(parsed.data.action, parsed.data.ids, parsed.data.reason);
  } catch (err) {
    if (err instanceof DeadLetterNotFoundError) {
      return NextResponse.json(
        {
          error: 'not_found',
          action: err.action,
          requested: err.requestedIds.length,
          missing: err.requestedIds,
        },
        { status: 404 },
      );
    }
    throw err;
  }

  return NextResponse.json({
    ok: true,
    count: result.affected.length,
    requested: parsed.data.ids.length,
    missing: parsed.data.ids.filter((id) => !result.affected.includes(id)),
  });
}
