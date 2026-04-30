import { describe, expect, it, vi } from 'vitest';

import { polygonFromCentroidMeters } from '../src/aoi.js';
import { SatelliteClient, SATELLITE_REQUEST_STREAM, satelliteRequestKey } from '../src/client.js';

import type { SatelliteRequest } from '../src/types.js';

function fakeQueue() {
  return {
    publish: vi.fn(async (_stream: string, _env: unknown) => 'ok'),
  };
}

const SAMPLE: SatelliteRequest = {
  request_id: 'evt_satellite_test_0001',
  project_id: '11111111-1111-1111-1111-111111111111',
  finding_id: null,
  aoi_geojson: polygonFromCentroidMeters({
    centroid: { lat: 3.866, lon: 11.5167 },
    radiusMeters: 500,
  }),
  contract_window: {
    start: '2025-01-01T00:00:00.000Z',
    end: '2025-04-01T00:00:00.000Z',
  },
  providers: ['nicfi', 'sentinel-2', 'sentinel-1'],
  max_cloud_pct: 20,
  max_cost_usd: 0,
  requested_by: 'test-suite',
};

describe('AUDIT-068 — SatelliteClient.request publishes the full envelope shape, not just request_id', () => {
  it('the envelope passed to queue.publish has every load-bearing field of SatelliteRequest', async () => {
    const q = fakeQueue();
    const client = new SatelliteClient(q as never);
    await client.request(SAMPLE);
    expect(q.publish).toHaveBeenCalledTimes(1);
    const [, env] = q.publish.mock.calls[0]! as [string, { payload: SatelliteRequest }];
    // Pin every field the SatelliteRequest schema requires — a regression
    // that drops a field at the publish boundary used to pass the
    // toHaveBeenCalledTimes(1) assertion silently. This locks down the
    // payload contract.
    expect(env.payload).toEqual({
      request_id: SAMPLE.request_id,
      project_id: SAMPLE.project_id,
      finding_id: SAMPLE.finding_id,
      aoi_geojson: SAMPLE.aoi_geojson,
      contract_window: SAMPLE.contract_window,
      providers: SAMPLE.providers,
      max_cloud_pct: SAMPLE.max_cloud_pct,
      max_cost_usd: SAMPLE.max_cost_usd,
      requested_by: SAMPLE.requested_by,
    });
  });
});

describe('SatelliteClient.request', () => {
  it('publishes a validated envelope to the satellite request stream', async () => {
    const q = fakeQueue();
    const client = new SatelliteClient(q as never);
    const r = await client.request(SAMPLE);
    expect(q.publish).toHaveBeenCalledTimes(1);
    const [stream, env] = q.publish.mock.calls[0]!;
    expect(stream).toBe(SATELLITE_REQUEST_STREAM);
    expect(env).toMatchObject({
      producer: 'satellite-client',
      payload: { request_id: SAMPLE.request_id },
    });
    expect(r.requestId).toBe(SAMPLE.request_id);
  });

  it('produces deterministic dedup keys', async () => {
    const q = fakeQueue();
    const client = new SatelliteClient(q as never);
    const a = await client.request(SAMPLE);
    const b = await client.request(SAMPLE);
    expect(a.dedupKey).toBe(b.dedupKey);
    // Stream got both publishes; the dedup is enforced server-side, not in the client.
    expect(q.publish).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed requests at the schema boundary', async () => {
    const q = fakeQueue();
    const client = new SatelliteClient(q as never);
    await expect(
      client.request({ ...SAMPLE, providers: [] as unknown as SatelliteRequest['providers'] }),
    ).rejects.toThrow();
    await expect(client.request({ ...SAMPLE, max_cloud_pct: -1 })).rejects.toThrow();
    expect(q.publish).not.toHaveBeenCalled();
  });
});

describe('AUDIT-054 — SatelliteClient emits structured events on failures', () => {
  function fakeLogger() {
    return {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      silent: vi.fn(),
      level: 'info',
      child: vi.fn(),
    };
  }

  it('logs satellite-request-validation-failed on schema rejection', async () => {
    const q = fakeQueue();
    const logger = fakeLogger();
    const client = new SatelliteClient(q as never, logger as never);
    await expect(client.request({ ...SAMPLE, max_cloud_pct: -1 })).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]![1]).toBe('satellite-request-validation-failed');
  });

  it('logs satellite-request-publish-failed on queue.publish() rejection', async () => {
    const q = {
      publish: vi.fn(async () => {
        throw new Error('redis-down');
      }),
    };
    const logger = fakeLogger();
    const client = new SatelliteClient(q as never, logger as never);
    await expect(client.request(SAMPLE)).rejects.toThrow(/redis-down/);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]![1]).toBe('satellite-request-publish-failed');
    expect(logger.error.mock.calls[0]![0]).toMatchObject({
      requestId: SAMPLE.request_id,
    });
  });

  it('does NOT log on the happy path', async () => {
    const q = fakeQueue();
    const logger = fakeLogger();
    const client = new SatelliteClient(q as never, logger as never);
    await client.request(SAMPLE);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('satelliteRequestKey', () => {
  it('uses project_id when present', () => {
    expect(
      satelliteRequestKey({
        projectId: 'p1',
        findingId: null,
        contractStart: '2025-01-01T00:00:00.000Z',
        contractEnd: '2025-04-01T00:00:00.000Z',
      }),
    ).toBe('sat:p1:2025-01-01:2025-04-01');
  });

  it('falls back to finding_id when project_id is null', () => {
    expect(
      satelliteRequestKey({
        projectId: null,
        findingId: 'f9',
        contractStart: '2025-01-01T00:00:00.000Z',
        contractEnd: '2025-04-01T00:00:00.000Z',
      }),
    ).toBe('sat:f9:2025-01-01:2025-04-01');
  });
});
