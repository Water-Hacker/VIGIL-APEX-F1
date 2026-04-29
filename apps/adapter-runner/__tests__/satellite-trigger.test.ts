import { describe, expect, it, vi } from 'vitest';

import { runSatelliteTrigger } from '../src/triggers/satellite-trigger.js';

const FAKE_LOGGER = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => FAKE_LOGGER,
};

function makeDeps(rows: Array<unknown>) {
  const db = { execute: vi.fn(async () => ({ rows })) };
  const tracker = {
    findByProjectWindow: vi.fn(async () => null as null),
    create: vi.fn(async (row: Record<string, unknown>) => row as never),
    listPending: vi.fn(async () => [] as never),
  };
  const satellite = { request: vi.fn(async () => ({ requestId: 'r', dedupKey: 'k' })) };
  return {
    db: db as never,
    satellite: satellite as never,
    trackingRepo: tracker as never,
    logger: FAKE_LOGGER as never,
    bufferMeters: 500,
    maxCloudPct: 20,
    maxCostUsd: 0,
    providers: ['nicfi', 'sentinel-2'] as const,
    _calls: { db, tracker, satellite },
  };
}

const yaoundeRow = {
  project_id: '11111111-1111-1111-1111-111111111111',
  lat: 3.866,
  lon: 11.5167,
  contract_start: new Date('2025-01-01T00:00:00Z'),
  contract_end: new Date('2025-04-01T00:00:00Z'),
};

const doualaRow = {
  project_id: '22222222-2222-2222-2222-222222222222',
  lat: 4.0511,
  lon: 9.7679,
  contract_start: new Date('2025-02-01T00:00:00Z'),
  contract_end: new Date('2025-05-01T00:00:00Z'),
};

const noGpsRow = {
  project_id: '33333333-3333-3333-3333-333333333333',
  lat: NaN,
  lon: NaN,
  contract_start: new Date('2025-01-01T00:00:00Z'),
  contract_end: new Date('2025-04-01T00:00:00Z'),
};

describe('runSatelliteTrigger', () => {
  it('publishes one envelope per GPS-bearing project candidate', async () => {
    const deps = makeDeps([yaoundeRow, doualaRow]);
    const r = await runSatelliteTrigger(deps);
    expect(r.enqueued).toBe(2);
    expect(r.skipped).toBe(0);
    expect(r.failed).toBe(0);
    expect(deps._calls.satellite.request).toHaveBeenCalledTimes(2);
    expect(deps._calls.tracker.create).toHaveBeenCalledTimes(2);
  });

  it('skips rows without finite GPS', async () => {
    const deps = makeDeps([yaoundeRow, noGpsRow]);
    const r = await runSatelliteTrigger(deps);
    expect(r.enqueued).toBe(1);
    expect(r.skipped).toBe(1);
    expect(deps._calls.satellite.request).toHaveBeenCalledTimes(1);
  });

  it('is idempotent on (project_id, contract_window) — second run is a no-op', async () => {
    const deps = makeDeps([yaoundeRow]);
    let pretend: unknown = null;
    deps._calls.tracker.findByProjectWindow.mockImplementation(async () => pretend);
    deps._calls.tracker.create.mockImplementation(async (r: Record<string, unknown>) => {
      pretend = r;
      return r as never;
    });
    const first = await runSatelliteTrigger(deps);
    expect(first.enqueued).toBe(1);
    const second = await runSatelliteTrigger(deps);
    expect(second.enqueued).toBe(0);
    expect(second.skipped).toBe(1);
    expect(deps._calls.satellite.request).toHaveBeenCalledTimes(1);
  });

  it('honours the per-tick rate cap', async () => {
    const lots = Array.from({ length: 10 }).map((_, i) => ({
      ...yaoundeRow,
      project_id: `${i}1111111-1111-1111-1111-111111111111`,
    }));
    const deps = makeDeps(lots);
    const r = await runSatelliteTrigger({ ...deps, perTickCap: 3 });
    expect(r.enqueued).toBe(3);
    expect(deps._calls.satellite.request).toHaveBeenCalledTimes(3);
  });

  it('skips rows with reversed contract windows', async () => {
    const reversed = {
      ...yaoundeRow,
      contract_start: new Date('2025-04-01T00:00:00Z'),
      contract_end: new Date('2025-01-01T00:00:00Z'),
    };
    const deps = makeDeps([reversed]);
    const r = await runSatelliteTrigger(deps);
    expect(r.enqueued).toBe(0);
    expect(r.skipped).toBe(1);
  });
});
