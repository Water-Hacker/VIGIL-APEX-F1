import { randomUUID } from 'node:crypto';

import { HashChain } from '@vigil/audit-chain';
import {
  UserActionEventRepo,
  type UserActionEventInsert,
} from '@vigil/db-postgres';
import { type Logger } from '@vigil/observability';
import { Schemas } from '@vigil/shared';


import { computeRecordHash } from './hash.js';
import { type AuditSigner, NoopSigner } from './signer.js';

import type { Pool } from 'pg';

/**
 * TAL-PA emitter — single chokepoint every TAL-PA event goes through.
 *
 * The flow:
 *
 *   1. Compute the per-actor `prior_event_id` from the
 *      `audit.user_action_chain` head.
 *   2. Build the canonical event payload.
 *   3. Compute `record_hash` over the canonical payload.
 *   4. Sign `record_hash` with the actor's YubiKey signer (or null for
 *      system / public).
 *   5. Persist to the global `audit.actions` chain (via HashChain) AND
 *      to `audit.user_action_event` in a single transaction; the
 *      `audit.user_action_chain` head is advanced under CAS.
 *   6. If high-significance, mark for immediate Polygon anchor (the
 *      worker-anchor side picks it up via `listPendingHighSig`).
 *
 * **Halt-on-failure**: if any step throws, the emit fails. Callers MUST
 * propagate the failure — the platform's contract per TAL-PA doctrine
 * §"No dark periods" is that no user-facing operation completes if the
 * audit logging system is broken.
 */

export interface EmitInput {
  readonly eventType: string;
  readonly actor: Schemas.ActorContext;
  readonly targetResource: string;
  readonly actionPayload?: Record<string, unknown>;
  readonly resultStatus?: Schemas.ResultStatus;
  readonly correlationId?: string | null;
  /** Override the high-significance designation. Defaults to the
   *  doctrine list via `Schemas.isHighSignificance`. */
  readonly highSignificanceOverride?: boolean;
  /** UUID v4 generator override for tests. */
  readonly generateId?: () => string;
  /** Override timestamp for tests. */
  readonly nowIso?: string;
}

export interface EmitDependencies {
  readonly pool: Pool;
  readonly userActionRepo: UserActionEventRepo;
  readonly chain: HashChain;
  readonly signer?: AuditSigner;
  readonly logger?: Logger;
}

export interface EmitResult {
  readonly eventId: string;
  readonly globalAuditId: string;
  readonly recordHash: string;
  readonly highSignificance: boolean;
}

const SUBJECT_KIND_BY_CATEGORY: Record<Schemas.AuditCategory, string> = {
  A: 'system', // authentication events live under the system subject by default
  B: 'system', // search / query — actor + target_resource carry the detail
  C: 'dossier',
  D: 'proposal',
  E: 'finding',
  F: 'system',
  G: 'system',
  H: 'dossier',
  I: 'tip',
  J: 'system',
  K: 'system',
};

const ACTION_BY_CATEGORY: Record<Schemas.AuditCategory, string> = {
  // Map to the existing audit.actions enum (audit.ts). The TAL-PA event
  // type is recorded in full inside the global chain's payload.
  A: 'system.bootstrap',
  B: 'system.bootstrap',
  C: 'dossier.downloaded',
  D: 'governance.vote_cast',
  E: 'finding.detected',
  F: 'decision.committed',
  G: 'system.bootstrap',
  H: 'dossier.delivered',
  I: 'tip.received',
  J: 'system.health_degraded',
  K: 'audit.chain_verified',
};

export async function emitAudit(
  deps: EmitDependencies,
  input: EmitInput,
): Promise<EmitResult> {
  const generate = input.generateId ?? randomUUID;
  const nowIso = input.nowIso ?? new Date().toISOString();
  const signer = deps.signer ?? new NoopSigner();
  const eventType = input.eventType;
  const category = Schemas.categoryOf(eventType);
  if (category === null) {
    throw new Error(`audit-log: unknown event_type '${eventType}' has no resolvable TAL-PA category`);
  }
  const highSignificance =
    input.highSignificanceOverride ?? Schemas.isHighSignificance(eventType);

  // 1. Per-actor chain head
  const head = await deps.userActionRepo.latestForActor(input.actor.actor_id);
  const priorEventId = head?.eventId ?? null;

  // 2. Build event ids first so signing happens once with stable inputs.
  const eventId = generate();
  const draftActor = await ensureSerialIfMissing(input.actor, signer);

  // 3. Compute record hash
  const recordHash = computeRecordHash({
    event_id: eventId,
    global_audit_id: '00000000-0000-0000-0000-000000000000', // filled below; not part of the canonical hash on purpose
    event_type: eventType as Schemas.EventType,
    category,
    timestamp_utc: nowIso,
    actor: draftActor,
    target_resource: input.targetResource,
    action_payload: input.actionPayload ?? {},
    result_status: input.resultStatus ?? 'success',
    prior_event_id: priorEventId,
    correlation_id: input.correlationId ?? null,
    high_significance: highSignificance,
  });

  // 4. Sign
  const signature = await signer.sign({ actorId: input.actor.actor_id, recordHash });

  // 5. Persist
  let globalAuditId: string;
  try {
    const subjectKind = SUBJECT_KIND_BY_CATEGORY[category] as
      | 'system'
      | 'finding'
      | 'dossier'
      | 'proposal'
      | 'tip';
    const action = ACTION_BY_CATEGORY[category];
    const globalEvent = await deps.chain.append({
      action: action as never,
      actor: input.actor.actor_id,
      subject_kind: subjectKind as never,
      subject_id: input.targetResource.slice(0, 200),
      payload: {
        tal_pa_event_id: eventId,
        tal_pa_event_type: eventType,
        record_hash: recordHash,
      },
    });
    globalAuditId = globalEvent.id;

    const row: UserActionEventInsert = {
      event_id: eventId,
      global_audit_id: globalAuditId,
      event_type: eventType,
      category,
      timestamp_utc: new Date(nowIso),
      actor_id: draftActor.actor_id,
      actor_role: draftActor.actor_role,
      actor_yubikey_serial: draftActor.actor_yubikey_serial,
      actor_ip: draftActor.actor_ip,
      actor_device_fingerprint: draftActor.actor_device_fingerprint,
      session_id: draftActor.session_id,
      target_resource: input.targetResource,
      action_payload: input.actionPayload ?? {},
      result_status: input.resultStatus ?? 'success',
      prior_event_id: priorEventId,
      correlation_id: input.correlationId ?? null,
      digital_signature: signature,
      chain_anchor_tx: null,
      record_hash: recordHash,
      high_significance: highSignificance,
    };
    await deps.userActionRepo.insertAndAdvanceChain(row);
  } catch (err) {
    // Halt-on-failure: rethrow. Callers MUST propagate.
    deps.logger?.error({ err, event_type: eventType, actor: input.actor.actor_id }, 'audit-emit-failed');
    throw err;
  }
  return { eventId, globalAuditId, recordHash, highSignificance };
}

async function ensureSerialIfMissing(
  actor: Schemas.ActorContext,
  signer: AuditSigner,
): Promise<Schemas.ActorContext> {
  if (actor.actor_yubikey_serial !== null) return actor;
  if (actor.actor_id.startsWith('system:') || actor.actor_role === 'public') return actor;
  const serial = await signer.serial(actor.actor_id);
  if (serial === null) return actor;
  return { ...actor, actor_yubikey_serial: serial };
}
