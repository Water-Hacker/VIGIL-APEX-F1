import { createLogger } from '@vigil/observability';
import { NextResponse, type NextRequest } from 'next/server';

import {
  AlertNoOpTransitionError,
  AlertNotFoundError,
  transitionAlertState,
  type AlertState,
} from '@/lib/alerts.server';
import { audit, AuditEmitterUnavailableError } from '@/lib/audit-emit.server';

const logger = createLogger({ service: 'api-alerts-acknowledge' });

/**
 * POST /api/alerts/[id]/acknowledge
 *
 * Transitions an `audit.anomaly_alert` row to a new operational
 * state. Body: `{ "state": "acknowledged" | "dismissed" |
 * "promoted_to_finding" }`. The transition emits a TAL-PA
 * `status.changed` user-action event BEFORE the row is mutated, so
 * the audit chain captures every operator-driven state change (no
 * "dark periods" per TAL-PA doctrine §"halt on audit failure").
 *
 * The route lives at .../acknowledge for URL clarity, but the body's
 * `state` field decides the target transition. This keeps a single
 * mutation surface — three POST routes for three states would be
 * redundant.
 *
 * RBAC: middleware `/api/alerts` rule restricts to
 * operator/auditor/architect. No further in-handler role check.
 *
 * Status codes:
 *   200 — { alert: AlertRow } after transition
 *   400 — invalid body / unknown target state
 *   404 — no such alert id
 *   409 — alert already in the target state (no-op)
 *   503 — audit emitter unavailable (halt-on-failure)
 */
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_TARGETS: ReadonlySet<AlertState> = new Set([
  'acknowledged',
  'dismissed',
  'promoted_to_finding',
]);

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const id = ctx.params.id;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid-id' }, { status: 400 });
  }

  let body: { state?: unknown };
  try {
    body = (await req.json()) as { state?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const target = body.state;
  if (typeof target !== 'string' || !ALLOWED_TARGETS.has(target as AlertState)) {
    return NextResponse.json({ error: 'invalid-target-state' }, { status: 400 });
  }
  const targetState = target as AlertState;

  try {
    return await audit(
      req,
      {
        eventType: 'status.changed',
        targetResource: `anomaly_alert:${id}`,
        actionPayload: { alert_id: id, to_state: targetState },
      },
      async () => {
        try {
          const after = await transitionAlertState(id, targetState);
          return NextResponse.json({ alert: after }, { status: 200 });
        } catch (err) {
          if (err instanceof AlertNotFoundError) {
            return NextResponse.json({ error: 'not-found' }, { status: 404 });
          }
          if (err instanceof AlertNoOpTransitionError) {
            return NextResponse.json(
              { error: 'already-in-state', state: err.state },
              { status: 409 },
            );
          }
          throw err;
        }
      },
    );
  } catch (err) {
    if (err instanceof AuditEmitterUnavailableError) {
      logger.error(
        { errName: err.name, errMsg: err.message, alert_id: id, to_state: targetState },
        'audit-emitter-unavailable',
      );
      return NextResponse.json({ error: 'audit-emitter-unavailable' }, { status: 503 });
    }
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error(
      { errName: e.name, errMsg: e.message, alert_id: id, to_state: targetState },
      'alerts-acknowledge-failed',
    );
    return NextResponse.json({ error: 'internal-error' }, { status: 500 });
  }
}
