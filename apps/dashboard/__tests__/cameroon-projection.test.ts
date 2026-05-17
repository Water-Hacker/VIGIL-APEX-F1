/**
 * Cameroon projection — load-bearing for every map render. A bug
 * here misplaces every region and silently produces a "wrong shape
 * of Cameroon" — the kind of regression a reviewer would notice
 * but a typecheck wouldn't.
 */
import { describe, expect, it } from 'vitest';

import {
  buildProjection,
  projectPoint,
  regionToSvgPath,
  regions,
} from '../src/lib/cameroon-projection';

describe('buildProjection — viewBox dimensions', () => {
  it('returns a viewBox of the requested width', () => {
    const p = buildProjection(720, 12);
    expect(p.width).toBe(720);
    expect(p.padding).toBe(12);
  });

  it('derives height from the Cameroon bbox aspect ratio', () => {
    const p = buildProjection(720, 0);
    // Cameroon bbox is ~lon [8.5, 16.2] = 7.7°, lat [1.7, 13.1] = 11.4°.
    // At cos(7.4°) ≈ 0.992, lon-on-the-ground is essentially flat.
    // Aspect lat/lon ≈ 11.4 / 7.7 = 1.48 → height ≈ 720 * 1.48 ≈ 1066.
    // Tolerate ±30px for rounding + bbox precision.
    expect(p.height).toBeGreaterThan(1000);
    expect(p.height).toBeLessThan(1130);
  });

  it('lonBounds + latBounds cover all features in the bundled geojson', () => {
    const p = buildProjection();
    const [minLon, maxLon] = p.lonBounds;
    const [minLat, maxLat] = p.latBounds;
    for (const f of regions()) {
      const polys =
        f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        for (const ring of poly) {
          for (const pt of ring) {
            const lon = pt[0]!;
            const lat = pt[1]!;
            expect(lon).toBeGreaterThanOrEqual(minLon);
            expect(lon).toBeLessThanOrEqual(maxLon);
            expect(lat).toBeGreaterThanOrEqual(minLat);
            expect(lat).toBeLessThanOrEqual(maxLat);
          }
        }
      }
    }
  });
});

describe('projectPoint — pixel-space mapping', () => {
  it('the south-west corner of the bbox maps near (padding, height-padding)', () => {
    const p = buildProjection(720, 12);
    const [sx, sy] = projectPoint(p.lonBounds[0], p.latBounds[0], p);
    expect(sx).toBeCloseTo(p.padding, 0);
    expect(sy).toBeCloseTo(p.height - p.padding, 0);
  });

  it('the north-east corner of the bbox maps near (width-padding, padding)', () => {
    const p = buildProjection(720, 12);
    const [ex, ey] = projectPoint(p.lonBounds[1], p.latBounds[1], p);
    expect(ex).toBeCloseTo(p.width - p.padding, 0);
    expect(ey).toBeCloseTo(p.padding, 0);
  });

  it('latitude flip: higher lat → lower y (north is up)', () => {
    const p = buildProjection();
    const [, ySouth] = projectPoint(2, 2, p);
    const [, yNorth] = projectPoint(2, 12, p);
    expect(yNorth).toBeLessThan(ySouth);
  });

  it('longitude correctness: higher lon → higher x (east is right)', () => {
    const p = buildProjection();
    const [xWest] = projectPoint(9, 5, p);
    const [xEast] = projectPoint(15, 5, p);
    expect(xEast).toBeGreaterThan(xWest);
  });
});

describe('regionToSvgPath — SVG d-attribute generation', () => {
  it('every region produces a non-empty path containing M + Z', () => {
    const p = buildProjection();
    for (const f of regions()) {
      const d = regionToSvgPath(f.geometry, p);
      expect(d.length).toBeGreaterThan(0);
      expect(d).toMatch(/^M/);
      expect(d).toMatch(/Z/);
    }
  });

  it('path numbers are formatted with at most 2 decimal places', () => {
    const p = buildProjection();
    const d = regionToSvgPath(regions()[0]!.geometry, p);
    // Match every number, confirm no more than 2 decimals.
    const numbers = d.match(/-?\d+\.\d+/g) ?? [];
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) {
      const decimals = n.split('.')[1] ?? '';
      expect(decimals.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('regions() — bundled data shape', () => {
  it('returns exactly 10 features (Cameroon admin-1 regions)', () => {
    expect(regions().length).toBe(10);
  });

  it('every region declares the expected properties shape', () => {
    for (const f of regions()) {
      expect(typeof f.properties.code).toBe('string');
      expect(typeof f.properties.name_fr).toBe('string');
      expect(typeof f.properties.gid).toBe('string');
      expect(typeof f.properties.iso).toBe('string');
      expect(Array.isArray(f.properties.centroid)).toBe(true);
      expect(f.properties.centroid.length).toBe(2);
    }
  });

  it('the 10 region codes match the canonical CMR_REGIONS set', () => {
    const codes = regions()
      .map((f) => f.properties.code)
      .sort();
    expect(codes).toEqual(['AD', 'CE', 'EN', 'ES', 'LT', 'NO', 'NW', 'OU', 'SU', 'SW']);
  });
});
