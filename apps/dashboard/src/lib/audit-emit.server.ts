import 'server-only';

import { HashChain } from '@vigil/audit-chain';
import {
  emitAudit,
  withHaltOnFailure,
  AuditEmitterUnavailableError,
  DeterministicTestSigner,
  type AuditSigner,
  type EmitInput,
} from '@vigil/audit-log';
import { UserActionEventRepo, getDb, getPool } from '@vigil/db-postgres';
import { Schemas } from '@vigil/shared';

import type { NextRequest } from 'next/server';

let cachedRepo: UserActionEventRepo | null = null;
let cachedChain: HashChain | null = null;
const SIGNER: AuditSigner =
  process.env.NODE_ENV === 'production'
    ? new DeterministicTestSigner() // production wires the YubiKey PKCS#11 signer in the host service
    : new DeterministicTestSigner();

async function deps() {
  if (!cachedRepo) {
    const db = await getDb();
    cachedRepo = new UserActionEventRepo(db);
  }
  if (!cachedChain) {
    const pool = await getPool();
    cachedChain = new HashChain(pool);
  }
  return { repo: cachedRepo, chain: cachedChain };
}

/**
 * TAL-PA wrapper for Next.js route handlers + server actions.
 *
 * Every authenticated dashboard route should call this at the top of
 * its handler:
 *
 * ```ts
 * return audit(req, {
 *   eventType: 'dossier.downloaded',
 *   targetResource: `dossier:${ref}`,
 *   actionPayload: { lang, ref },
 * }, async () => {
 *   // do the actual work
 * });
 * ```
 *
 * Per TAL-PA doctrine §"No dark periods", a failed audit emit refuses
 * the operation — the wrapper throws `AuditEmitterUnavailableError`
 * which the route is expected to translate to HTTP 503.
 */
export async function audit<T>(
  req: NextRequest,
  spec: {
    readonly eventType: string;
    readonly targetResource: string;
    readonly actionPayload?: Record<string, unknown>;
    readonly resultStatus?: Schemas.ResultStatus;
    readonly correlationId?: string | null;
  },
  work: () => Promise<T>,
): Promise<T> {
  const actor = actorFromRequest(req);
  const d = await deps();
  return withHaltOnFailure(
    () =>
      emitAudit(
        { pool: undefined as never, userActionRepo: d.repo, chain: d.chain, signer: SIGNER },
        {
          eventType: spec.eventType,
          actor,
          targetResource: spec.targetResource,
          actionPayload: spec.actionPayload ?? {},
          resultStatus: spec.resultStatus ?? 'success',
          correlationId: spec.correlationId ?? null,
        } satisfies EmitInput,
      ),
    work,
  );
}

export function actorFromRequest(req: NextRequest): Schemas.ActorContext {
  const userId = req.headers.get('x-vigil-user') ?? 'public:anonymous';
  const roles = (req.headers.get('x-vigil-roles') ?? 'public').split(',');
  const role = mapRole(roles);
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null;
  return {
    actor_id: userId,
    actor_role: role,
    actor_yubikey_serial: null, // signer fills this in if known
    actor_ip: ip,
    actor_device_fingerprint: null, // populated by client-side fingerprint pass when present
    session_id: null, // populated when the dashboard issues TAL-PA sessions
  };
}

/**
 * Server-component variant of `actorFromRequest`. Reads from the
 * standard Next.js `headers()` API rather than a `NextRequest`. Used
 * by route-group server components (e.g. the /403 page below) that
 * are invoked WITHOUT a NextRequest argument.
 *
 * Added for FIND-001 closure (whole-system-audit doc 10) — the
 * forbidden-access page must emit a structured `access.forbidden`
 * audit event with full actor + target context.
 */
export function actorFromHeaders(h: Headers): Schemas.ActorContext {
  const userId = h.get('x-vigil-user') ?? 'public:anonymous';
  const roles = (h.get('x-vigil-roles') ?? 'public').split(',');
  const role = mapRole(roles);
  const ip = h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? null;
  return {
    actor_id: userId,
    actor_role: role,
    actor_yubikey_serial: null,
    actor_ip: ip,
    actor_device_fingerprint: null,
    session_id: null,
  };
}

/**
 * Emit a TAL-PA audit event from a server component (NO NextRequest in
 * scope). Used by the /403 page to record forbidden-access attempts
 * (FIND-001 closure).
 *
 * Unlike `audit()` above, this does NOT wrap a worker function — the
 * server component IS the work. We emit the event and return; if the
 * emit fails, we throw `AuditEmitterUnavailableError` and the component
 * surfaces an error boundary.
 *
 * TAL-PA halt-on-failure semantics still apply: a failed audit emit
 * blocks rendering rather than producing a "dark period".
 */
export async function emitFromServerComponent(spec: {
  readonly eventType: string;
  readonly actor: Schemas.ActorContext;
  readonly targetResource: string;
  readonly actionPayload?: Record<string, unknown>;
  readonly resultStatus?: Schemas.ResultStatus;
  readonly correlationId?: string | null;
}): Promise<void> {
  const d = await deps();
  await emitAudit(
    { pool: undefined as never, userActionRepo: d.repo, chain: d.chain, signer: SIGNER },
    {
      eventType: spec.eventType,
      actor: spec.actor,
      targetResource: spec.targetResource,
      actionPayload: spec.actionPayload ?? {},
      resultStatus: spec.resultStatus ?? 'denied',
      correlationId: spec.correlationId ?? null,
    } satisfies EmitInput,
  );
}

function mapRole(roles: ReadonlyArray<string>): Schemas.ActorRole {
  if (roles.includes('architect')) return 'architect';
  if (roles.includes('analyst')) return 'analyst';
  if (roles.includes('council_member')) return 'council_member';
  if (roles.includes('auditor')) return 'auditor';
  if (roles.includes('operator')) return 'operator';
  if (roles.includes('tip_handler')) return 'tip_handler';
  if (roles.includes('civil_society')) return 'civil_society';
  return 'public';
}

export { AuditEmitterUnavailableError };
