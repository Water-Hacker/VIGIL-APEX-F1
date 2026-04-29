import { createHash } from 'node:crypto';

import type { Schemas } from '@vigil/shared';

/**
 * Canonical record_hash computation — TAL-PA doctrine §"What each audit
 * record contains".
 *
 * Hash inputs are serialised in a fixed key order with NFKC-normalised
 * string values + ISO timestamp strings, so two runs that produce
 * structurally identical events produce the same hash regardless of
 * runtime field iteration order.
 */
export function computeRecordHash(
  event: Omit<Schemas.UserActionEvent, 'record_hash' | 'chain_anchor_tx' | 'digital_signature'>,
): string {
  const canonical = {
    event_id: event.event_id,
    global_audit_id: event.global_audit_id,
    event_type: event.event_type,
    category: event.category,
    timestamp_utc: event.timestamp_utc,
    actor: {
      actor_id: event.actor.actor_id.normalize('NFKC'),
      actor_role: event.actor.actor_role,
      actor_yubikey_serial: event.actor.actor_yubikey_serial,
      actor_ip: event.actor.actor_ip,
      actor_device_fingerprint: event.actor.actor_device_fingerprint,
      session_id: event.actor.session_id,
    },
    target_resource: event.target_resource.normalize('NFKC'),
    action_payload: sortObject(event.action_payload),
    result_status: event.result_status,
    prior_event_id: event.prior_event_id,
    correlation_id: event.correlation_id,
    high_significance: event.high_significance,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function sortObject(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortObject);
  const obj = v as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = sortObject(obj[k]);
  return sorted;
}
