/**
 * Server-side region aggregator — UI-only mode produces a known
 * synthetic distribution that exercises every cell of the
 * choropleth (zero, low, mid, high, saturated).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { aggregateByRegion } from '../src/lib/regions.server';

describe('aggregateByRegion (UI-only mode synthetic data)', () => {
  const originalFlag = process.env.VIGIL_UI_ONLY;
  beforeEach(() => {
    process.env.VIGIL_UI_ONLY = '1';
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.VIGIL_UI_ONLY;
    else process.env.VIGIL_UI_ONLY = originalFlag;
  });

  it('returns exactly 10 rollups (one per region) — even regions with zero findings', async () => {
    const agg = await aggregateByRegion();
    expect(agg.rollups.length).toBe(10);
  });

  it('honours the window-days option (defaults to 90)', async () => {
    const def = await aggregateByRegion();
    expect(def.window_days).toBe(90);
    const custom = await aggregateByRegion({ windowDays: 30 });
    expect(custom.window_days).toBe(30);
  });

  it('the synthetic distribution exercises the full colour range', async () => {
    const agg = await aggregateByRegion();
    const scores = agg.rollups.map((r) => r.severity_weighted_score);
    // We expect: at least one zero-score region (empty cell), at
    // least one saturated region (>= max * 0.8), and at least one
    // region in the middle (~ max * 0.3..0.5).
    expect(scores.filter((s) => s === 0).length).toBeGreaterThanOrEqual(1);
    expect(scores.some((s) => s >= agg.max_weighted_score * 0.8)).toBe(true);
    expect(scores.some((s) => s > 0 && s < agg.max_weighted_score * 0.5)).toBe(true);
  });

  it('total matches the sum of per-region counts', async () => {
    const agg = await aggregateByRegion();
    const sum = agg.rollups.reduce((s, r) => s + r.count, 0);
    expect(agg.total).toBe(sum);
  });

  it('max_weighted_score matches the largest rollup score', async () => {
    const agg = await aggregateByRegion();
    const localMax = agg.rollups.reduce((m, r) => Math.max(m, r.severity_weighted_score), 0);
    expect(agg.max_weighted_score).toBe(localMax);
  });

  it('every rollup carries bilingual region names', async () => {
    const agg = await aggregateByRegion();
    for (const r of agg.rollups) {
      expect(r.name_fr.length).toBeGreaterThan(0);
      expect(r.name_en.length).toBeGreaterThan(0);
    }
  });

  it('escalated_count never exceeds count (data-integrity invariant)', async () => {
    const agg = await aggregateByRegion();
    for (const r of agg.rollups) {
      expect(r.escalated_count).toBeLessThanOrEqual(r.count);
    }
  });

  it('posterior_max is null only when count is zero', async () => {
    const agg = await aggregateByRegion();
    for (const r of agg.rollups) {
      if (r.count === 0) {
        expect(r.posterior_max).toBeNull();
      } else {
        expect(r.posterior_max).toBeGreaterThan(0);
        expect(r.posterior_max).toBeLessThanOrEqual(1);
      }
    }
  });

  it('deterministic — two consecutive calls return the same snapshot', async () => {
    const a = await aggregateByRegion();
    const b = await aggregateByRegion();
    expect(a.total).toBe(b.total);
    expect(a.max_weighted_score).toBe(b.max_weighted_score);
    expect(a.rollups.map((r) => r.severity_weighted_score)).toEqual(
      b.rollups.map((r) => r.severity_weighted_score),
    );
  });
});

describe('aggregateByRegion (production path) — synth-flag absence', () => {
  // We can't actually hit Postgres in a unit test, so we just
  // assert the function recognises the synth flag is OFF. The
  // actual DB-bound path is exercised by integration tests gated
  // on INTEGRATION_DB_URL (same pattern as the audit-log-cas test).

  const originalFlag = process.env.VIGIL_UI_ONLY;
  beforeEach(() => {
    delete process.env.VIGIL_UI_ONLY;
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.VIGIL_UI_ONLY;
    else process.env.VIGIL_UI_ONLY = originalFlag;
  });

  it('attempts to reach Postgres when VIGIL_UI_ONLY is unset', async () => {
    // We expect this to throw (no Postgres in the test env). The
    // test passes by virtue of the throw — confirming the function
    // takes the production branch, not the synth branch.
    let threw = false;
    try {
      await aggregateByRegion();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
