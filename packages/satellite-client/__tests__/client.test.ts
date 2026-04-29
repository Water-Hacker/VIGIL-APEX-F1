import { describe, expect, it, vi } from 'vitest';

import { SatelliteClient, SATELLITE_REQUEST_STREAM, satelliteRequestKey } from '../src/client.js';
import { polygonFromCentroidMeters } from '../src/aoi.js';
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
    await expect(
      client.request({ ...SAMPLE, max_cloud_pct: -1 }),
    ).rejects.toThrow();
    expect(q.publish).not.toHaveBeenCalled();
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
