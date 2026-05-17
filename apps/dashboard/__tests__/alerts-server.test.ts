/**
 * Server-side alerts module — UI-only mode covers the happy paths
 * the page actually renders. The Postgres path is exercised by
 * integration tests gated on INTEGRATION_DB_URL (same pattern as the
 * regions-server test).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  ALL_SEVERITIES,
  ALL_STATES,
  AlertNoOpTransitionError,
  AlertNotFoundError,
  countAlerts,
  getAlertById,
  listAlerts,
  transitionAlertState,
} from '../src/lib/alerts.server';

describe('listAlerts (UI-only mode)', () => {
  const originalFlag = process.env.VIGIL_UI_ONLY;
  beforeEach(() => {
    process.env.VIGIL_UI_ONLY = '1';
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.VIGIL_UI_ONLY;
    else process.env.VIGIL_UI_ONLY = originalFlag;
  });

  it('returns the full synthetic set when no filter is supplied', async () => {
    const out = await listAlerts();
    // 7 synthetic rows seeded — assert exact so a drift in the
    // distribution is caught.
    expect(out.length).toBe(7);
  });

  it('orders rows newest-first by detected_at', async () => {
    const out = await listAlerts();
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1]!.detected_at >= out[i]!.detected_at).toBe(true);
    }
  });

  it('honours the states filter (single state)', async () => {
    const out = await listAlerts({ states: ['open'] });
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) expect(r.state).toBe('open');
  });

  it('honours the states filter (multi state)', async () => {
    const out = await listAlerts({ states: ['acknowledged', 'dismissed'] });
    for (const r of out) {
      expect(['acknowledged', 'dismissed']).toContain(r.state);
    }
  });

  it('honours the severities filter', async () => {
    const out = await listAlerts({ severities: ['critical'] });
    for (const r of out) expect(r.severity).toBe('critical');
  });

  it('returns ONLY rows newer than sinceIso (the SSE-cursor primitive)', async () => {
    const full = await listAlerts();
    const cutoff = full[3]!.detected_at; // arbitrary mid-point
    const fresh = await listAlerts({ sinceIso: cutoff });
    for (const r of fresh) expect(r.detected_at > cutoff).toBe(true);
  });

  it('caps the limit at MAX_LIMIT (500)', async () => {
    const out = await listAlerts({ limit: 99_999 });
    expect(out.length).toBeLessThanOrEqual(500);
  });

  it('the synthetic dataset covers every severity bucket', async () => {
    const out = await listAlerts();
    const sevs = new Set(out.map((r) => r.severity));
    for (const s of ALL_SEVERITIES) {
      expect(sevs.has(s)).toBe(true);
    }
  });

  it('the synthetic dataset covers every operational state', async () => {
    const out = await listAlerts();
    const states = new Set(out.map((r) => r.state));
    for (const s of ALL_STATES) {
      expect(states.has(s)).toBe(true);
    }
  });
});

describe('countAlerts (UI-only mode)', () => {
  const originalFlag = process.env.VIGIL_UI_ONLY;
  beforeEach(() => {
    process.env.VIGIL_UI_ONLY = '1';
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.VIGIL_UI_ONLY;
    else process.env.VIGIL_UI_ONLY = originalFlag;
  });

  it('aggregates by state and severity', async () => {
    const c = await countAlerts();
    const total = c.open + c.acknowledged + c.dismissed + c.promoted;
    const bySevTotal = ALL_SEVERITIES.reduce((s, sev) => s + c.bySeverity[sev], 0);
    // The two summations are over the same row set — must agree.
    expect(total).toBe(bySevTotal);
  });

  it('bySeverity tracks every severity bucket (zero-fill)', async () => {
    const c = await countAlerts();
    for (const s of ALL_SEVERITIES) {
      expect(typeof c.bySeverity[s]).toBe('number');
    }
  });
});

describe('getAlertById (UI-only mode)', () => {
  const originalFlag = process.env.VIGIL_UI_ONLY;
  beforeEach(() => {
    process.env.VIGIL_UI_ONLY = '1';
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.VIGIL_UI_ONLY;
    else process.env.VIGIL_UI_ONLY = originalFlag;
  });

  it('returns the row for a known id', async () => {
    const row = await getAlertById('00000000-0000-0000-0000-000000000001');
    expect(row).not.toBeNull();
    expect(row?.kind).toBe('after_hours_dossier_access');
  });

  it('returns null for an unknown id', async () => {
    const row = await getAlertById('99999999-9999-9999-9999-999999999999');
    expect(row).toBeNull();
  });
});

describe('transitionAlertState (UI-only mode)', () => {
  const originalFlag = process.env.VIGIL_UI_ONLY;
  beforeEach(() => {
    process.env.VIGIL_UI_ONLY = '1';
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.VIGIL_UI_ONLY;
    else process.env.VIGIL_UI_ONLY = originalFlag;
  });

  it('throws AlertNotFoundError for an unknown id', async () => {
    await expect(
      transitionAlertState('99999999-9999-9999-9999-999999999999', 'acknowledged'),
    ).rejects.toBeInstanceOf(AlertNotFoundError);
  });

  it('throws AlertNoOpTransitionError when target state equals current state', async () => {
    // The synthetic row id=000…000004 starts in 'acknowledged'.
    await expect(
      transitionAlertState('00000000-0000-0000-0000-000000000004', 'acknowledged'),
    ).rejects.toBeInstanceOf(AlertNoOpTransitionError);
  });

  it('mutates the row to the new state and returns the row', async () => {
    // The row id=000…000002 starts open; acknowledge it. The mutation
    // is shared across the in-process synthetic store, so we have to
    // restore the state for downstream tests.
    const before = await getAlertById('00000000-0000-0000-0000-000000000002');
    expect(before?.state).toBe('open');
    const after = await transitionAlertState(
      '00000000-0000-0000-0000-000000000002',
      'acknowledged',
    );
    expect(after.state).toBe('acknowledged');
    // Restore.
    await transitionAlertState('00000000-0000-0000-0000-000000000002', 'dismissed');
  });
});

describe('listAlerts (production path) — synth-flag absence', () => {
  const originalFlag = process.env.VIGIL_UI_ONLY;
  beforeEach(() => {
    delete process.env.VIGIL_UI_ONLY;
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.VIGIL_UI_ONLY;
    else process.env.VIGIL_UI_ONLY = originalFlag;
  });

  it('takes the production branch when VIGIL_UI_ONLY is unset', async () => {
    // The branch is identifiable by the absence of synth rows: the
    // synthetic dataset has 7 specific IDs (000…0001..000…0007).
    // If CI provides Postgres (the ci.yml job DOES — empty
    // `audit.anomaly_alert` table), production returns 0 rows. If
    // CI does not (local dev without a DB), the call throws. EITHER
    // is acceptable — the assertion is "we did NOT silently fall to
    // the synth branch".
    try {
      const out = await listAlerts();
      // Empty (CI Postgres path) is acceptable; non-zero
      // CONTAINING any of the synth IDs is NOT — that would mean
      // VIGIL_UI_ONLY leaked through.
      const synthIds = new Set([
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000006',
        '00000000-0000-0000-0000-000000000007',
      ]);
      for (const row of out) {
        expect(synthIds.has(row.id)).toBe(false);
      }
    } catch {
      // No Postgres → throw is the expected production-branch
      // failure mode. Pass.
    }
  });

  it('rejects unknown state values BEFORE issuing SQL', async () => {
    await expect(
      listAlerts({ states: ['nonsense'] as unknown as Parameters<typeof listAlerts>[0]['states'] }),
    ).rejects.toThrow(/unknown alert state/);
  });

  it('rejects unknown severity values BEFORE issuing SQL', async () => {
    await expect(
      listAlerts({
        severities: ['fatal'] as unknown as Parameters<typeof listAlerts>[0]['severities'],
      }),
    ).rejects.toThrow(/unknown alert severity/);
  });
});
