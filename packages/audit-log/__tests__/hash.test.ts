import { describe, expect, it } from 'vitest';

import type { Schemas } from '@vigil/shared';

import { computeRecordHash } from '../src/hash.js';

const baseEvent = (
  over: Partial<Schemas.UserActionEvent> = {},
): Omit<Schemas.UserActionEvent, 'record_hash' | 'chain_anchor_tx' | 'digital_signature'> => ({
  event_id: '00000000-0000-0000-0000-000000000001',
  global_audit_id: '00000000-0000-0000-0000-000000000999',
  event_type: 'auth.login_succeeded' as Schemas.EventType,
  category: 'A' as Schemas.AuditCategory,
  timestamp_utc: '2026-04-29T00:00:00.000Z' as Schemas.UserActionEvent['timestamp_utc'],
  actor: {
    actor_id: 'user-1',
    actor_role: 'operator',
    actor_yubikey_serial: 'YK-1234567',
    actor_ip: '10.0.0.1',
    actor_device_fingerprint: 'a'.repeat(64),
    session_id: '00000000-0000-0000-0000-000000000abc',
  },
  target_resource: 'session:abc',
  action_payload: { from: 'web' },
  result_status: 'success',
  prior_event_id: null,
  correlation_id: null,
  high_significance: false,
  ...over,
});

describe('computeRecordHash', () => {
  it('is deterministic for the same canonical event', () => {
    const e = baseEvent();
    expect(computeRecordHash(e)).toEqual(computeRecordHash(e));
  });

  it('changes when any field changes', () => {
    const a = computeRecordHash(baseEvent());
    const b = computeRecordHash(baseEvent({ target_resource: 'session:def' }));
    expect(a).not.toEqual(b);
  });

  it('is order-independent on action_payload keys', () => {
    const a = computeRecordHash(baseEvent({ action_payload: { z: 1, a: 2 } }));
    const b = computeRecordHash(baseEvent({ action_payload: { a: 2, z: 1 } }));
    expect(a).toEqual(b);
  });

  it('changes when actor_ip changes (different network event)', () => {
    const a = computeRecordHash(
      baseEvent({
        actor: {
          actor_id: 'user-1',
          actor_role: 'operator',
          actor_yubikey_serial: 'YK-1234567',
          actor_ip: '10.0.0.1',
          actor_device_fingerprint: 'a'.repeat(64),
          session_id: '00000000-0000-0000-0000-000000000abc',
        },
      }),
    );
    const b = computeRecordHash(
      baseEvent({
        actor: {
          actor_id: 'user-1',
          actor_role: 'operator',
          actor_yubikey_serial: 'YK-1234567',
          actor_ip: '10.0.0.2',
          actor_device_fingerprint: 'a'.repeat(64),
          session_id: '00000000-0000-0000-0000-000000000abc',
        },
      }),
    );
    expect(a).not.toEqual(b);
  });

  it('emits a 64-hex-character digest', () => {
    expect(computeRecordHash(baseEvent())).toMatch(/^[a-f0-9]{64}$/);
  });
});
