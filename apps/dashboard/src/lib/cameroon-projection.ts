/**
 * Equirectangular projection from WGS84 lon/lat to SVG pixel space,
 * specialised for Cameroon's bounding box.
 *
 * We use a simple plate-carrée (equirectangular) projection rather
 * than a more accurate alternative (Albers equal-area, UTM) because:
 *
 *   1. Cameroon's latitudinal extent (2°N to 13°N) is narrow enough
 *      that area distortion under equirectangular stays under 4 % at
 *      the country boundary — invisible at our render scale.
 *   2. The math is trivial, fully deterministic, no external
 *      dependency (no proj4, no d3-geo).
 *   3. Server-rendered SVG must have stable output across runs; a
 *      pure-math projection guarantees that. d3-geo's path generator
 *      depends on canvas semantics and is harder to unit-test
 *      offline.
 *
 * Layout: padding=8, lock the aspect ratio of Cameroon's bbox, fit
 * into a viewBox of width 600 by default. Y is flipped (SVG y grows
 * downward; latitude grows upward).
 *
 * The bbox is precomputed from `cameroon-admin1.geojson.json` at
 * module load via importing the data file and walking every ring.
 * That keeps this module the SINGLE source of truth for projection
 * parameters; consumers (the heatmap renderer, the legend, any
 * future overlays) all read derived values from here.
 */

import geo from '../data/cameroon-admin1.geojson.json';

/**
 * Minimal GeoJSON typing — the bundled file uses a fixed structure
 * (FeatureCollection of Polygon | MultiPolygon with our RegionProps).
 * Avoid the `@types/geojson` dependency since we only consume the
 * subset listed here.
 */
export interface Polygon {
  readonly type: 'Polygon';
  readonly coordinates: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>;
}
export interface MultiPolygon {
  readonly type: 'MultiPolygon';
  readonly coordinates: ReadonlyArray<ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>>;
}
export interface Feature<G, P> {
  readonly type: 'Feature';
  readonly properties: P;
  readonly geometry: G;
}
export interface FeatureCollection<G, P> {
  readonly type: 'FeatureCollection';
  readonly features: ReadonlyArray<Feature<G, P>>;
}

const GEO = geo as unknown as FeatureCollection<Polygon | MultiPolygon, RegionProps>;

export interface RegionProps {
  readonly code: string;
  readonly name_fr: string;
  readonly gid: string;
  readonly iso: string;
  readonly centroid: readonly [number, number];
}

export interface ProjectionParams {
  /** SVG viewBox width in pixels. */
  readonly width: number;
  /** SVG viewBox height in pixels. */
  readonly height: number;
  /** Inset (pixels) around the country outline. */
  readonly padding: number;
  /** lon bounds (min, max) — from the bundled geojson. */
  readonly lonBounds: readonly [number, number];
  /** lat bounds (min, max) — from the bundled geojson. */
  readonly latBounds: readonly [number, number];
}

function computeBbox(): { lon: [number, number]; lat: [number, number] } {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const f of GEO.features) {
    const polys: ReadonlyArray<ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>> =
      f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        for (const pt of ring) {
          const lon = pt[0]!;
          const lat = pt[1]!;
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
  }
  return { lon: [minLon, maxLon], lat: [minLat, maxLat] };
}

const BBOX = computeBbox();

/**
 * Build a projection that fits the country bbox into a viewBox of
 * width `targetWidth`. Height is derived from the aspect ratio so
 * the country isn't stretched.
 */
export function buildProjection(targetWidth: number = 600, padding: number = 8): ProjectionParams {
  const [minLon, maxLon] = BBOX.lon;
  const [minLat, maxLat] = BBOX.lat;
  // At Cameroon's mean latitude (~7.5°N) lon-degrees are slightly
  // shorter than lat-degrees on the ground. Adjust the lon range by
  // cos(meanLat) so the country isn't visually squashed horizontally.
  const meanLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((meanLat * Math.PI) / 180);
  const lonExtent = (maxLon - minLon) * lonScale;
  const latExtent = maxLat - minLat;
  const innerWidth = targetWidth - padding * 2;
  const innerHeight = innerWidth * (latExtent / lonExtent);
  const height = innerHeight + padding * 2;
  return {
    width: targetWidth,
    height: Math.round(height),
    padding,
    lonBounds: [minLon, maxLon],
    latBounds: [minLat, maxLat],
  };
}

/**
 * Project a single (lon, lat) point to (x, y) in SVG pixel space.
 * Pure function; can be called inside the SVG render loop.
 */
export function projectPoint(
  lon: number,
  lat: number,
  p: ProjectionParams,
): readonly [number, number] {
  const [minLon, maxLon] = p.lonBounds;
  const [minLat, maxLat] = p.latBounds;
  const meanLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((meanLat * Math.PI) / 180);
  const lonExtent = (maxLon - minLon) * lonScale;
  const latExtent = maxLat - minLat;
  const innerWidth = p.width - p.padding * 2;
  const innerHeight = p.height - p.padding * 2;
  const sx = innerWidth / lonExtent;
  const sy = innerHeight / latExtent;
  const x = p.padding + (lon - minLon) * lonScale * sx;
  // Flip y: latitude grows upward, SVG y grows downward.
  const y = p.padding + (maxLat - lat) * sy;
  return [x, y];
}

/**
 * Convert a GeoJSON ring [[lon,lat],...] into an SVG `d` path
 * fragment: "M x1,y1 L x2,y2 L x3,y3 ... Z".
 */
export function ringToSvgPath(
  ring: ReadonlyArray<ReadonlyArray<number>>,
  p: ProjectionParams,
): string {
  if (ring.length === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i] as [number, number];
    const [x, y] = projectPoint(lon, lat, p);
    parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

/**
 * Build the full `d` path for a region's geometry (Polygon or
 * MultiPolygon). Each ring is a separate sub-path joined into one
 * string so the whole region is hit-testable as a single SVG element.
 * SVG fill-rule "evenodd" handles holes correctly when a Polygon
 * has multiple rings.
 */
export function regionToSvgPath(geometry: Polygon | MultiPolygon, p: ProjectionParams): string {
  const rings: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>> =
    geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  return rings.map((r) => ringToSvgPath(r, p)).join(' ');
}

/**
 * Read-only access to the bundled geojson, typed.
 */
export function regions(): ReadonlyArray<Feature<Polygon | MultiPolygon, RegionProps>> {
  return GEO.features;
}

/**
 * Compute the projected centroid for a region — used to anchor
 * labels and the bubble visualisation. The centroid in the geojson
 * properties is in lon/lat; here we project it.
 */
export function projectedCentroid(
  feature: Feature<Polygon | MultiPolygon, RegionProps>,
  p: ProjectionParams,
): readonly [number, number] {
  const [lon, lat] = feature.properties.centroid;
  return projectPoint(lon, lat, p);
}
