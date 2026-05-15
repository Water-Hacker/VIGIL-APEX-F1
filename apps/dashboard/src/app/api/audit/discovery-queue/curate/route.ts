import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { curateCandidate } from '../../../../../lib/pattern-discovery.server';

/**
 * POST /api/audit/discovery-queue/curate
 *
 * Auditor + architect curation endpoint for worker-pattern-discovery
 * output. Accepts form-encoded body (the page renders a regular
 * `<form>` so this works without JS) with:
 *
 *   id        uuid of pattern_discovery.candidate row
 *   decision  'promoted' | 'dismissed' | 'merged'
 *   notes     optional free-form
 *
 * RBAC: middleware enforces /api/audit/* allow=[auditor, architect].
 * Defensive re-check here against `x-vigil-roles` matches the
 * pattern in /api/findings/[id]/route.ts (W-15 / FIND-009 closure).
 */

const OPERATOR_ROLES = new Set(['auditor', 'architect']);

const zForm = z.object({
  id: z.string().uuid(),
  decision: z.enum(['promoted', 'dismissed', 'merged']),
  notes: z.string().max(2_000).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const roles = (req.headers.get('x-vigil-roles') ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (!roles.some((r) => OPERATOR_ROLES.has(r))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const actor =
    req.headers.get('x-vigil-username') ?? req.headers.get('x-forwarded-user') ?? 'unknown';

  const contentType = req.headers.get('content-type') ?? '';
  let raw: Record<string, unknown> = {};
  if (contentType.includes('application/json')) {
    raw = (await req.json()) as Record<string, unknown>;
  } else {
    const form = await req.formData();
    raw = Object.fromEntries(form.entries()) as Record<string, unknown>;
  }
  const parsed = zForm.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid-input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    await curateCandidate({
      id: parsed.data.id,
      decision: parsed.data.decision,
      actor,
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
    });
  } catch (err) {
    console.error('[discovery-queue/curate] error', err);
    return NextResponse.json({ error: 'server-error' }, { status: 500 });
  }

  // Form posts: redirect back to the queue so the row disappears.
  if (!contentType.includes('application/json')) {
    return NextResponse.redirect(new URL('/audit/discovery-queue', req.url), 303);
  }
  return NextResponse.json({ ok: true });
}
