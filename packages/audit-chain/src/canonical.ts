import { createHash } from 'node:crypto';

import type { Schemas } from '@vigil/shared';

/**
 * Canonical body serialisation.
 *
 * The body hash MUST be deterministic — different code paths producing the
 * same logical event MUST yield the same `body_hash`. We achieve this by:
 *   1. Sorting object keys recursively
 *   2. Removing `body_hash` and `prev_hash` from the object before hashing
 *   3. Stringifying with no whitespace and Unicode-NFC normalisation
 *
 * The hash is over a `<seq>|<action>|<actor>|<subject_kind>|<subject_id>|<occurred_at>|<json>`
 * line so that the linear ordering of fields cannot be exploited for collisions.
 */

type AuditEventLike = Pick<
  Schemas.AuditEvent,
  'seq' | 'action' | 'actor' | 'subject_kind' | 'subject_id' | 'occurred_at' | 'payload'
>;

export function canonicalise(event: AuditEventLike): string {
  const stableJson = JSON.stringify(sortKeys(event.payload));
  return [
    event.seq,
    event.action,
    event.actor.normalize('NFC'),
    event.subject_kind,
    event.subject_id,
    event.occurred_at,
    stableJson.normalize('NFC'),
  ].join('|');
}

export function bodyHash(event: AuditEventLike): string {
  return createHash('sha256').update(canonicalise(event)).digest('hex');
}

export function rowHash(prevHash: string | null, body: string): string {
  return createHash('sha256').update(`${prevHash ?? '0'.repeat(64)}|${body}`).digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}
