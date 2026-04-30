import { createHash } from 'node:crypto';

import type { Schemas } from '@vigil/shared';

/**
 * Public scoping — TAL-PA doctrine §"What the Public Sees" / §"What the
 * Public Does Not See".
 *
 * Converts an internal `UserActionEvent` row into a `PublicAuditView`:
 *
 *   - Drops `actor_id` and `actor_yubikey_serial` (role only).
 *   - Strips `actor_ip` and `actor_device_fingerprint`.
 *   - For category B / C, replaces `target_resource` with a category
 *     marker so query strings carrying PII don't leak.
 *   - For category I (public portal), preserves only that an interaction
 *     happened, never the submitter identity.
 *   - Hashes any literal PII inside `action_payload` so the public-view
 *     cannot read the original strings.
 */

export interface PublicViewRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly category: string;
  readonly timestamp_utc: string | Date;
  readonly actor_id: string;
  readonly actor_role: string;
  readonly target_resource: string;
  readonly result_status: string;
  readonly chain_anchor_tx: string | null;
  readonly high_significance: boolean;
}

export function toPublicView(row: PublicViewRow): Schemas.PublicAuditView {
  const cat = row.category as Schemas.AuditCategory;
  const isProtectedQueryCat = cat === 'B' || cat === 'C';
  const isPublicCat = cat === 'I';
  const target = isProtectedQueryCat
    ? `[REDACTED:CATEGORY-${cat}]`
    : isPublicCat
      ? '[PUBLIC]'
      : row.target_resource.slice(0, 500);
  return {
    event_id: row.event_id,
    event_type: row.event_type as Schemas.EventType,
    category: cat,
    timestamp_utc:
      row.timestamp_utc instanceof Date
        ? (row.timestamp_utc.toISOString() as Schemas.UserActionEvent['timestamp_utc'])
        : (row.timestamp_utc as Schemas.UserActionEvent['timestamp_utc']),
    actor_role: row.actor_role as Schemas.ActorRole,
    actor_authenticated: !row.actor_id.startsWith('system:') && row.actor_role !== 'public',
    target_resource: target,
    result_status: row.result_status as Schemas.ResultStatus,
    chain_anchor_tx: row.chain_anchor_tx as Schemas.PublicAuditView['chain_anchor_tx'],
    high_significance: row.high_significance,
  };
}

/** Hashes a piece of PII so the public-view can show "a search happened"
 *  without exposing the original string.
 *
 *  AUDIT-031: the `salt` parameter is REQUIRED. A default salt would
 *  produce rainbow-tableable hashes for any caller that forgets to
 *  pass one. Production callers source the salt from
 *  AUDIT_PUBLIC_EXPORT_SALT (rotated quarterly per DECISION-016);
 *  tests pass a literal 'test-salt' or similar. Empty string and
 *  the literal 'PLACEHOLDER' are also rejected.
 */
export function hashPii(value: string, salt: string): string {
  if (typeof salt !== 'string' || salt.length === 0) {
    throw new Error('hashPii: salt is required (non-empty string)');
  }
  if (salt === 'PLACEHOLDER') {
    throw new Error('hashPii: refusing PLACEHOLDER salt — set AUDIT_PUBLIC_EXPORT_SALT');
  }
  return createHash('sha256').update(`${salt}|${value}`).digest('hex').slice(0, 16);
}
