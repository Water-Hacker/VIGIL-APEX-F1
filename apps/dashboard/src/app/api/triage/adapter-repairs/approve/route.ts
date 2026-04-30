import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { decideProposal, ProposalNotEligibleError } from '../../../../../lib/adapter-repair.server';

export const dynamic = 'force-dynamic';

const zBody = z.object({
  proposal_id: z.string().uuid(),
  decision: z.enum(['promoted', 'rejected']),
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const roles = (req.headers.get('x-vigil-roles') ?? '').split(',').filter(Boolean);
  // Critical adapter approvals require architect role; operators can
  // only flip non-critical (and the worker auto-promotes those anyway,
  // so the operator's role here is effectively to manually trigger
  // a non-critical promotion early or to reject a noisy candidate).
  if (!(roles.includes('operator') || roles.includes('architect'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = zBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });
  }

  const decidedBy = req.headers.get('x-vigil-username') ?? 'unknown';
  try {
    await decideProposal(
      parsed.data.proposal_id,
      parsed.data.decision,
      decidedBy,
      parsed.data.reason,
    );
  } catch (err) {
    // AUDIT-006: a stale UI click on an already-decided / unknown
    // proposal returns 409 (Conflict) so the operator can refresh.
    if (err instanceof ProposalNotEligibleError) {
      return NextResponse.json(
        {
          error: 'not_eligible',
          proposal_id: err.proposalId,
          attempted: err.attemptedDecision,
        },
        { status: 409 },
      );
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
