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
const SIGNER: AuditSigner = process.env.NODE_ENV === 'production'
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
  const username = req.headers.get('x-vigil-username') ?? 'public:anonymous';
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
