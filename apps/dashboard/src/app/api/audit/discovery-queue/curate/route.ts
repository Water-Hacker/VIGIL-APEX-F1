import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAuthProof } from '../../../../../lib/auth-proof-require';
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
 * Tier-34 audit closure: the in-handler check now uses the
 * middleware-minted auth-proof HMAC (T17 pattern) instead of the
 * spoofable `x-vigil-roles` header.
 */

const zForm = z.object({
  id: z.string().uuid(),
  decision: z.enum(['promoted', 'dismissed', 'merged']),
  notes: z.string().max(2_000).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuthProof(req, { allowedRoles: ['auditor', 'architect'] });
  if (!auth.ok) return auth.response!;
  const actor =
    auth.actor ??
    req.headers.get('x-vigil-username') ??
    req.headers.get('x-forwarded-user') ??
    'unknown';

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
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(
      '[discovery-queue/curate] error',
      JSON.stringify({ err_name: e.name, err_message: e.message }),
    );
    return NextResponse.json({ error: 'server-error' }, { status: 500 });
  }

  // Form posts: redirect back to the queue so the row disappears.
  if (!contentType.includes('application/json')) {
    return NextResponse.redirect(new URL('/audit/discovery-queue', req.url), 303);
  }
  return NextResponse.json({ ok: true });
}
