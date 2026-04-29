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
  if (opts.radiusMeters <= 0) {
    throw new Error('radiusMeters must be positive');
  }
  const dLat = (opts.radiusMeters / EARTH_RADIUS_METERS) / DEG;
  const cosLat = Math.cos(opts.centroid.lat * DEG);
  if (cosLat < 1e-9) {
    throw new Error('centroid latitude too close to a pole for equirectangular bbox');
  }
  const dLon = (opts.radiusMeters / (EARTH_RADIUS_METERS * cosLat)) / DEG;
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
