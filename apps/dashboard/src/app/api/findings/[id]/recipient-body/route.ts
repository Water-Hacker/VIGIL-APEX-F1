import { HashChain } from '@vigil/audit-chain';
import { DossierRepo, FindingRepo, getDb, getPool } from '@vigil/db-postgres';
import { Schemas } from '@vigil/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

/**
 * POST /api/findings/[id]/recipient-body
 *
 * Operator override (or architect) of the dossier recipient body. The most
 * recent decision is the truth-of-record consulted by worker-governance at
 * escalation time. Existing un-delivered dossier rows are re-routed in the
 * same transaction (DossierRepo.setRecipientBody handles the cascade).
 *
 * DECISION-010.
 */
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  recipient_body_name: z.enum([
    'CONAC',
    'COUR_DES_COMPTES',
    'MINFI',
    'ANIF',
    'CDC',
    'OTHER',
  ]),
  rationale: z.string().min(8).max(2_000),
});

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const findingId = ctx.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(findingId)) {
    return NextResponse.json({ error: 'invalid-finding-id' }, { status: 400 });
  }
  const json = (await req.json().catch(() => null)) as unknown;
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid-body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const db = await getDb();
  const findingRepo = new FindingRepo(db);
  const dossierRepo = new DossierRepo(db);
  const finding = await findingRepo.getById(findingId);
  if (!finding) {
    return NextResponse.json({ error: 'finding-not-found' }, { status: 404 });
  }

  const operator = req.headers.get('x-vigil-username') ?? 'unknown';
  const decision = await dossierRepo.setRecipientBody(
    findingId,
    parsed.data.recipient_body_name,
    'operator',
    operator,
    parsed.data.rationale,
  );

  // Audit row.
  try {
    const pool = await getPool();
    const chain = new HashChain(pool);
    await chain.append({
      action: 'dossier.recipient_body_changed',
      actor: operator,
      subject_kind: 'finding',
      subject_id: findingId,
      payload: {
        from_recommended: finding.recommended_recipient_body,
        to: parsed.data.recipient_body_name,
        rationale: parsed.data.rationale,
        decision_id: decision.id,
      },
    });
  } catch (err) {
    console.error('audit-emit-failed', err);
  }

  // Mirror the decision into the Schemas type for the response so callers
  // can render it with the exact runtime shape.
  const response: { decision: Schemas.RoutingDecision } = {
    decision: {
      id: decision.id,
      finding_id: decision.finding_id,
      recipient_body_name: decision.recipient_body_name as Schemas.RecipientBody,
      source: decision.source as Schemas.RoutingDecisionSource,
      decided_by: decision.decided_by,
      decided_at: decision.decided_at.toISOString(),
      rationale: decision.rationale,
    },
  };
  return NextResponse.json(response, { status: 200 });
}
