/**
 * AUDIT-046 — emitAudit honours an injected Clock.
 *
 * The emit path used `new Date().toISOString()` as the inline default
 * for `nowIso`. Tests could already override per-call via
 * `input.nowIso`, but a `deps.clock` injection cleans up the contract
 * and lets a test fix all timestamps for a whole suite.
 */
import { Time } from '@vigil/shared';
import { describe, expect, it, vi } from 'vitest';

import { emitAudit } from '../src/emit.js';

import type { ActorContext, EventType } from '@vigil/shared/dist/schemas/audit-log.js';

function makeDeps(opts: { clock?: Time.Clock; recordedRow?: { current: unknown } }) {
  const recorded: { current: unknown } = opts.recordedRow ?? { current: null };
  const userActionRepo = {
    latestForActor: vi.fn(async () => null),
    insertAndAdvanceChain: vi.fn(async (row: unknown) => {
      recorded.current = row;
    }),
  };
  const chain = {
    append: vi.fn(async () => ({
      id: 'global-audit-evt-1',
      seq: 1,
      timestamp_utc: '2026-04-30T12:00:00Z',
      action: 'audit.tip_received',
      actor: 'system:test',
      subject_kind: 'tip',
      subject_id: 't-1',
      payload: {},
      prev_hash: null,
      body_hash: 'h',
    })),
  };
  const pool = {} as never;
  return {
    deps: {
      pool,
      userActionRepo,
      chain,
      ...(opts.clock !== undefined && { clock: opts.clock }),
    } as unknown as Parameters<typeof emitAudit>[0],
    recorded,
    userActionRepo,
  };
}

const actor: ActorContext = {
  actor_id: 'system:test',
  actor_role: 'system',
  actor_yubikey_serial: null,
  actor_ip: null,
  actor_device_fingerprint: null,
  session_id: null,
} as unknown as ActorContext;

describe('AUDIT-046 — emitAudit Clock injection', () => {
  it('uses deps.clock.isoNow() when input.nowIso is omitted', async () => {
    const FROZEN = '2026-04-30T08:30:45.000Z';
    const clock: Time.Clock = {
      now: () => Date.parse(FROZEN) as unknown as Time.EpochMs,
      isoNow: () => FROZEN as unknown as Time.IsoInstant,
    };
    const { deps, recorded } = makeDeps({ clock });
    await emitAudit(deps, {
      eventType: 'public.tip_submitted' as EventType,
      actor,
      targetResource: 'tip:abc',
    });
    const row = recorded.current as { timestamp_utc: Date };
    expect(row.timestamp_utc.toISOString()).toBe(FROZEN);
  });

  it('per-call input.nowIso wins over deps.clock', async () => {
    const FROZEN = '2026-04-30T08:30:45.000Z';
    const OVERRIDE = '2026-04-30T18:00:00.000Z';
    const clock: Time.Clock = {
      now: () => Date.parse(FROZEN) as unknown as Time.EpochMs,
      isoNow: () => FROZEN as unknown as Time.IsoInstant,
    };
    const { deps, recorded } = makeDeps({ clock });
    await emitAudit(deps, {
      eventType: 'public.tip_submitted' as EventType,
      actor,
      targetResource: 'tip:abc',
      nowIso: OVERRIDE,
    });
    const row = recorded.current as { timestamp_utc: Date };
    expect(row.timestamp_utc.toISOString()).toBe(OVERRIDE);
  });

  it('falls back to systemClock when neither is supplied (current behaviour preserved)', async () => {
    const before = Date.now();
    const { deps, recorded } = makeDeps({});
    await emitAudit(deps, {
      eventType: 'public.tip_submitted' as EventType,
      actor,
      targetResource: 'tip:abc',
    });
    const row = recorded.current as { timestamp_utc: Date };
    const t = row.timestamp_utc.getTime();
    const after = Date.now();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after + 100);
  });
});
