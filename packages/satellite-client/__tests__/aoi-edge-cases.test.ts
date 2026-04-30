/**
 * AUDIT-064 — AOI buffer geometry edge cases.
 *
 * Existing aoi.test.ts covers happy-path (Yaoundé / Douala / mid-Africa).
 * This file pins the geographic edge cases the original AUDIT-064 description
 * called out: equator, dateline, pole proximity, southern + western
 * hemispheres, varying radius scales (10 m up to 5 km), and the documented
 * 0.5 % accuracy bound at the Cameroon latitude band.
 *
 * Reference (no external dep): the equirectangular bbox at radius r metres
 * around (lat0, lon0) yields:
 *   dLat = r / EARTH_RADIUS / DEG
 *   dLon = r / (EARTH_RADIUS * cos(lat0)) / DEG
 *
 * which matches src/aoi.ts. Tests assert the analytical relationship rather
 * than a snapshot.
 */
import { describe, expect, it } from 'vitest';

import {
  bboxFromCentroidMeters,
  bboxesFromCentroidMeters,
  centroidOfPolygon,
  polygonFromCentroidMeters,
} from '../src/aoi.js';

const EARTH_RADIUS_METERS = 6_371_000;
const DEG = Math.PI / 180;

// Helper for analytical verification
const expectedDLat = (radiusMeters: number) => radiusMeters / EARTH_RADIUS_METERS / DEG;

describe('AUDIT-064 — equator', () => {
  it('produces a near-square bbox at lat=0 (cos(0)=1, dLat ≈ dLon)', () => {
    const b = bboxFromCentroidMeters({ centroid: { lat: 0, lon: 0 }, radiusMeters: 1000 });
    const dLat = b.maxLat - b.minLat;
    const dLon = b.maxLon - b.minLon;
    expect(dLat).toBeCloseTo(dLon, 9);
    expect(dLat / 2).toBeCloseTo(expectedDLat(1000), 9);
  });

  it('round-trip centroid through a polygon at the equator', () => {
    const p = polygonFromCentroidMeters({ centroid: { lat: 0, lon: 0 }, radiusMeters: 500 });
    const back = centroidOfPolygon(p);
    expect(back.lat).toBeCloseTo(0, 9);
    expect(back.lon).toBeCloseTo(0, 9);
  });
});

describe('AUDIT-089 — bboxesFromCentroidMeters wraps at the antimeridian', () => {
  it('returns a single bbox when centroid+radius does not cross the dateline', () => {
    // Yaoundé — well clear of ±180.
    const out = bboxesFromCentroidMeters({
      centroid: { lat: 3.866, lon: 11.5167 },
      radiusMeters: 5000,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.minLon).toBeGreaterThan(-180);
    expect(out[0]!.maxLon).toBeLessThan(180);
  });

  it('returns two bboxes when crossing the antimeridian eastbound (centroid near 179.99)', () => {
    const out = bboxesFromCentroidMeters({
      centroid: { lat: 0, lon: 179.99 },
      radiusMeters: 5000,
    });
    expect(out).toHaveLength(2);
    // First bbox extends to 180 (eastern slice).
    expect(out[0]!.maxLon).toBe(180);
    // Second bbox starts at -180 (western slice).
    expect(out[1]!.minLon).toBe(-180);
    // Each bbox is normalised within [-180, 180].
    for (const b of out) {
      expect(b.minLon).toBeGreaterThanOrEqual(-180);
      expect(b.maxLon).toBeLessThanOrEqual(180);
    }
  });

  it('returns two bboxes when crossing the antimeridian westbound (centroid near -179.99)', () => {
    const out = bboxesFromCentroidMeters({
      centroid: { lat: 0, lon: -179.99 },
      radiusMeters: 5000,
    });
    expect(out).toHaveLength(2);
    for (const b of out) {
      expect(b.minLon).toBeGreaterThanOrEqual(-180);
      expect(b.maxLon).toBeLessThanOrEqual(180);
    }
  });

  it('latitude is preserved across the split (only longitude is split)', () => {
    const out = bboxesFromCentroidMeters({
      centroid: { lat: 0, lon: 180 },
      radiusMeters: 5000,
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.minLat).toBe(out[1]!.minLat);
    expect(out[0]!.maxLat).toBe(out[1]!.maxLat);
  });

  it('combined longitude span of the two bboxes equals the original radius span', () => {
    const r = 5000;
    const out = bboxesFromCentroidMeters({ centroid: { lat: 0, lon: 179.99 }, radiusMeters: r });
    const span0 = out[0]!.maxLon - out[0]!.minLon;
    const span1 = out[1]!.maxLon - out[1]!.minLon;
    const raw = bboxFromCentroidMeters({ centroid: { lat: 0, lon: 179.99 }, radiusMeters: r });
    const expected = raw.maxLon - raw.minLon;
    expect(span0 + span1).toBeCloseTo(expected, 9);
  });
});

describe('AUDIT-064 — dateline (longitude wrap)', () => {
  it('bbox at lon=179.99 produces a maxLon that crosses 180 (current behaviour: no wrap)', () => {
    // Document current behaviour. The function returns raw arithmetic
    // values — maxLon may exceed 180. Cameroon use case never hits
    // this, but a future caller using AOI for dateline-spanning regions
    // would need a wrap-aware version. Pin the current behaviour so
    // the design choice is explicit.
    const b = bboxFromCentroidMeters({
      centroid: { lat: 0, lon: 179.99 },
      radiusMeters: 5000,
    });
    expect(b.maxLon).toBeGreaterThan(180);
    expect(b.minLon).toBeLessThan(179.99);
  });

  it('bbox at lon=-180 boundary returns symmetric values', () => {
    const b = bboxFromCentroidMeters({
      centroid: { lat: 0, lon: -180 },
      radiusMeters: 1000,
    });
    expect(b.maxLon - -180).toBeCloseTo(-180 - b.minLon, 9);
  });
});

describe('AUDIT-064 — pole proximity', () => {
  it('rejects exact pole (lat=90)', () => {
    expect(() =>
      bboxFromCentroidMeters({ centroid: { lat: 90, lon: 0 }, radiusMeters: 100 }),
    ).toThrow(/pole/i);
  });

  it('rejects exact south pole (lat=-90)', () => {
    expect(() =>
      bboxFromCentroidMeters({ centroid: { lat: -90, lon: 0 }, radiusMeters: 100 }),
    ).toThrow(/pole/i);
  });

  it('accepts 89° (very-high latitude); dLon scales by 1/cos(89°) ≈ 57x dLat', () => {
    const b = bboxFromCentroidMeters({
      centroid: { lat: 89, lon: 0 },
      radiusMeters: 1000,
    });
    const dLat = b.maxLat - b.minLat;
    const dLon = b.maxLon - b.minLon;
    expect(dLon / dLat).toBeCloseTo(1 / Math.cos(89 * DEG), 4);
    expect(dLon).toBeGreaterThan(50 * dLat);
  });

  it('rejects when cos(lat) < 1e-9 (numerical pole guard)', () => {
    // lat just below 90 such that cos(lat) becomes < 1e-9.
    // cos(89.99999999) ≈ 1.745e-10 — should trigger the guard.
    expect(() =>
      bboxFromCentroidMeters({
        centroid: { lat: 89.99999999, lon: 0 },
        radiusMeters: 100,
      }),
    ).toThrow(/pole/i);
  });
});

describe('AUDIT-064 — southern hemisphere', () => {
  it('handles negative latitudes (Southern Cameroon ≈ 2°S)', () => {
    const c = { lat: -2.5, lon: 14.7 };
    const b = bboxFromCentroidMeters({ centroid: c, radiusMeters: 500 });
    expect(b.minLat).toBeLessThan(c.lat);
    expect(b.maxLat).toBeGreaterThan(c.lat);
    expect(b.maxLat - c.lat).toBeCloseTo(c.lat - b.minLat, 9);
  });

  it('cos(-lat) === cos(lat); dLon symmetric across hemispheres', () => {
    const north = bboxFromCentroidMeters({
      centroid: { lat: 30, lon: 0 },
      radiusMeters: 1000,
    });
    const south = bboxFromCentroidMeters({
      centroid: { lat: -30, lon: 0 },
      radiusMeters: 1000,
    });
    expect(north.maxLon - north.minLon).toBeCloseTo(south.maxLon - south.minLon, 9);
  });
});

describe('AUDIT-064 — western hemisphere', () => {
  it('handles negative longitudes (Atlantic-side Cameroon ≈ -1°E hypothetical)', () => {
    const c = { lat: 4, lon: -1.5 };
    const b = bboxFromCentroidMeters({ centroid: c, radiusMeters: 1500 });
    expect(b.minLon).toBeLessThan(c.lon);
    expect(b.maxLon).toBeGreaterThan(c.lon);
  });
});

describe('AUDIT-064 — radius scaling', () => {
  it.each([[10], [100], [500], [1000], [5000]])(
    'radius %d m matches dLat = r / EARTH_R / DEG analytically',
    (radius) => {
      const b = bboxFromCentroidMeters({
        centroid: { lat: 3.866, lon: 11.5167 },
        radiusMeters: radius,
      });
      const dLat = b.maxLat - b.minLat;
      expect(dLat / 2).toBeCloseTo(expectedDLat(radius), 9);
    },
  );

  it('5 km accuracy bound — within 0.5% of true 5 km at Cameroon latitude', () => {
    // Verifies the SRD §13.10 / src/aoi.ts comment claim:
    // "error at Yaoundé (3.87 °N) is well under 0.1 % at 500 m radius".
    // Test the tighter bound at 5 km (the upper limit the function
    // documents as suitable).
    const b = bboxFromCentroidMeters({
      centroid: { lat: 3.866, lon: 11.5167 },
      radiusMeters: 5000,
    });
    const dLatMeters = (b.maxLat - 3.866) * 111_320; // metres per degree of lat (mean Earth)
    expect(Math.abs(dLatMeters - 5000)).toBeLessThan(25); // 0.5 %
  });
});

describe('AUDIT-064 — polygon ring closure invariants', () => {
  it('first === last vertex (closed ring)', () => {
    const p = polygonFromCentroidMeters({
      centroid: { lat: 0, lon: 0 },
      radiusMeters: 1000,
    });
    const ring = p.coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('exactly 5 vertices (4 corners + closure)', () => {
    const p = polygonFromCentroidMeters({
      centroid: { lat: -3, lon: 9 },
      radiusMeters: 100,
    });
    expect(p.coordinates[0]!.length).toBe(5);
  });

  it('vertices form a counter-clockwise ring (GeoJSON RFC 7946 outer-ring convention)', () => {
    // GeoJSON RFC 7946 §3.1.6: outer rings should be counter-clockwise.
    // Shoelace sum ∑(x_{i+1}-x_i)(y_{i+1}+y_i) is NEGATIVE for CCW
    // rings in standard (x=lon, y=lat) Cartesian coords.
    // src/aoi.ts emits [minLon,minLat] -> [maxLon,minLat] -> [maxLon,maxLat]
    // -> [minLon,maxLat] -> [minLon,minLat] which is CCW (RFC 7946-compliant).
    const p = polygonFromCentroidMeters({
      centroid: { lat: 4, lon: 11.5 },
      radiusMeters: 500,
    });
    const ring = p.coordinates[0]!;
    let signedArea = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i]!;
      const [x2, y2] = ring[i + 1]!;
      signedArea += (x2 - x1) * (y2 + y1);
    }
    expect(signedArea).toBeLessThan(0);
  });
});

describe('AUDIT-064 — error path arity', () => {
  it('rejects 3-vertex (degenerate) polygons in centroidOfPolygon', () => {
    expect(() =>
      centroidOfPolygon({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [0, 0],
          ],
        ],
      }),
    ).toThrow(/four/i);
  });

  it('rejects empty outer ring', () => {
    expect(() => centroidOfPolygon({ type: 'Polygon', coordinates: [[]] })).toThrow();
  });

  it('AUDIT-090 — NaN radius is rejected by the !Number.isFinite guard', () => {
    expect(() =>
      bboxFromCentroidMeters({
        centroid: { lat: 0, lon: 0 },
        radiusMeters: Number.NaN,
      }),
    ).toThrow(/positive finite number/);
  });

  it('AUDIT-091 — Infinity radius is rejected by the !Number.isFinite guard', () => {
    expect(() =>
      bboxFromCentroidMeters({
        centroid: { lat: 0, lon: 0 },
        radiusMeters: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/positive finite number/);
  });

  it('AUDIT-091 — negative Infinity radius is rejected', () => {
    expect(() =>
      bboxFromCentroidMeters({
        centroid: { lat: 0, lon: 0 },
        radiusMeters: Number.NEGATIVE_INFINITY,
      }),
    ).toThrow(/positive finite number/);
  });
});
