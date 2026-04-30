import type { PolygonGeoJson } from './types.js';

/**
 * Geodesy helpers for converting a centroid + radius (in metres) into a
 * bounding box and a GeoJSON Polygon. Pure; no I/O.
 *
 * Uses the equirectangular approximation suitable for radii ≤ 5 km, which
 * covers every infrastructure project we'd want to verify. The error at
 * Yaoundé (3.87 °N) is well under 0.1 % at 500 m radius.
 */

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

export interface BBox {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const DEG = Math.PI / 180;

export function bboxFromCentroidMeters(opts: {
  readonly centroid: LatLon;
  readonly radiusMeters: number;
}): BBox {
  // AUDIT-090 / AUDIT-091 — guard rejects NaN (NaN <= 0 is false, so NaN
  // would pass an unsigned `<= 0` check) and Infinity (Infinity > 0 is
  // true, so it would also pass). The combined Number.isFinite + > 0
  // predicate covers every non-positive-finite-number input.
  if (!Number.isFinite(opts.radiusMeters) || opts.radiusMeters <= 0) {
    throw new Error('radiusMeters must be a positive finite number');
  }
  const dLat = opts.radiusMeters / EARTH_RADIUS_METERS / DEG;
  const cosLat = Math.cos(opts.centroid.lat * DEG);
  if (cosLat < 1e-9) {
    throw new Error('centroid latitude too close to a pole for equirectangular bbox');
  }
  const dLon = opts.radiusMeters / (EARTH_RADIUS_METERS * cosLat) / DEG;
  return {
    minLon: opts.centroid.lon - dLon,
    minLat: opts.centroid.lat - dLat,
    maxLon: opts.centroid.lon + dLon,
    maxLat: opts.centroid.lat + dLat,
  };
}

export function polygonFromCentroidMeters(opts: {
  readonly centroid: LatLon;
  readonly radiusMeters: number;
}): PolygonGeoJson {
  const b = bboxFromCentroidMeters(opts);
  return {
    type: 'Polygon',
    coordinates: [
      [
        [b.minLon, b.minLat],
        [b.maxLon, b.minLat],
        [b.maxLon, b.maxLat],
        [b.minLon, b.maxLat],
        [b.minLon, b.minLat],
      ],
    ],
  };
}

/**
 * AUDIT-089 — dateline-aware AOI helper.
 *
 * Returns one bbox when the centroid+radius does NOT cross the
 * antimeridian, OR two bboxes when it does. Each bbox is normalised so
 * `minLon` and `maxLon` are within `[-180, 180]`. The two-bbox form is
 * what Sentinel Hub / Planet / Maxar all accept directly — most
 * provider APIs document a side-by-side AOI as the canonical
 * dateline-spanning shape.
 *
 * Cameroon (8-16°E) never crosses the antimeridian; this helper exists
 * for federation peers in other longitudes (Pacific Rim members, future
 * partners) and for defence-in-depth on hostile / mistaken inputs.
 *
 * `bboxFromCentroidMeters` (above) keeps the simpler single-bbox form
 * for back-compat: it returns un-wrapped longitudes (maxLon may exceed
 * 180), which the original AUDIT-064 pinning test asserts. Callers
 * who need the wrapped form should use `bboxesFromCentroidMeters`.
 */
export function bboxesFromCentroidMeters(opts: {
  readonly centroid: LatLon;
  readonly radiusMeters: number;
}): ReadonlyArray<BBox> {
  const raw = bboxFromCentroidMeters(opts);
  // No wrap needed — most cases including Cameroon.
  if (raw.minLon >= -180 && raw.maxLon <= 180) {
    return [raw];
  }
  // Crosses the antimeridian. Normalise both ends into [-180, 180]
  // and split the bbox at the seam.
  const wrap = (lon: number): number => {
    let v = ((lon + 180) % 360) - 180;
    if (v < -180) v += 360;
    if (v > 180) v -= 360;
    return v;
  };
  const wrappedMin = wrap(raw.minLon);
  const wrappedMax = wrap(raw.maxLon);
  // After wrap, wrappedMax < wrappedMin in the dateline-crossing case.
  // Split: [wrappedMin .. 180] U [-180 .. wrappedMax].
  return [
    { minLon: wrappedMin, minLat: raw.minLat, maxLon: 180, maxLat: raw.maxLat },
    { minLon: -180, minLat: raw.minLat, maxLon: wrappedMax, maxLat: raw.maxLat },
  ];
}

/** Centroid of a (closed) GeoJSON Polygon's outer ring; rough average. */
export function centroidOfPolygon(polygon: PolygonGeoJson): LatLon {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 4) {
    throw new Error('polygon outer ring must have at least four positions (closed)');
  }
  // Last point repeats the first; ignore for the average.
  const interior = ring.slice(0, -1);
  let sumLon = 0;
  let sumLat = 0;
  for (const [lon, lat] of interior) {
    sumLon += lon;
    sumLat += lat;
  }
  return { lat: sumLat / interior.length, lon: sumLon / interior.length };
}
