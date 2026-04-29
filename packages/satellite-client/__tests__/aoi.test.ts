import { describe, expect, it } from 'vitest';

import {
  bboxFromCentroidMeters,
  centroidOfPolygon,
  polygonFromCentroidMeters,
} from '../src/aoi.js';

const YAOUNDE = { lat: 3.866, lon: 11.5167 };
const DOUALA = { lat: 4.0511, lon: 9.7679 };

describe('bboxFromCentroidMeters', () => {
  it('produces a symmetric bbox around the centroid', () => {
    const b = bboxFromCentroidMeters({ centroid: YAOUNDE, radiusMeters: 500 });
    expect(b.minLon).toBeLessThan(YAOUNDE.lon);
    expect(b.maxLon).toBeGreaterThan(YAOUNDE.lon);
    expect(b.minLat).toBeLessThan(YAOUNDE.lat);
    expect(b.maxLat).toBeGreaterThan(YAOUNDE.lat);
    // Symmetry within float precision
    expect(b.maxLon - YAOUNDE.lon).toBeCloseTo(YAOUNDE.lon - b.minLon, 9);
    expect(b.maxLat - YAOUNDE.lat).toBeCloseTo(YAOUNDE.lat - b.minLat, 9);
  });

  it('approximates 500 m at Yaoundé latitude (within 0.5 %)', () => {
    const b = bboxFromCentroidMeters({ centroid: YAOUNDE, radiusMeters: 500 });
    const dLatDeg = b.maxLat - YAOUNDE.lat;
    const dLatMeters = dLatDeg * 111_320; // meters per degree of latitude
    expect(Math.abs(dLatMeters - 500)).toBeLessThan(2.5); // 0.5 %
  });

  it('rejects non-positive radii', () => {
    expect(() =>
      bboxFromCentroidMeters({ centroid: YAOUNDE, radiusMeters: 0 }),
    ).toThrow();
    expect(() =>
      bboxFromCentroidMeters({ centroid: YAOUNDE, radiusMeters: -1 }),
    ).toThrow();
  });

  it('rejects polar latitudes', () => {
    expect(() =>
      bboxFromCentroidMeters({ centroid: { lat: 90, lon: 0 }, radiusMeters: 100 }),
    ).toThrow();
  });
});

describe('polygonFromCentroidMeters', () => {
  it('returns a closed 5-vertex GeoJSON Polygon', () => {
    const p = polygonFromCentroidMeters({ centroid: DOUALA, radiusMeters: 500 });
    expect(p.type).toBe('Polygon');
    expect(p.coordinates).toHaveLength(1);
    const ring = p.coordinates[0]!;
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]); // closed
  });

  it('round-trips through centroidOfPolygon back to the input centroid', () => {
    for (const c of [YAOUNDE, DOUALA, { lat: -2.5, lon: 14.7 }]) {
      const p = polygonFromCentroidMeters({ centroid: c, radiusMeters: 750 });
      const back = centroidOfPolygon(p);
      expect(back.lat).toBeCloseTo(c.lat, 6);
      expect(back.lon).toBeCloseTo(c.lon, 6);
    }
  });
});

describe('centroidOfPolygon', () => {
  it('rejects polygons with insufficient vertices', () => {
    expect(() =>
      centroidOfPolygon({
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [0, 0]]],
      }),
    ).toThrow();
  });
});
