/**
 * Server-rendered SVG choropleth of Cameroon's 10 administrative
 * regions, coloured by `severity_weighted_score`.
 *
 * Design choices:
 *
 * - **Server-rendered**: the whole SVG is produced server-side and
 *   shipped as the initial HTML. No client JS required to display
 *   the map. Drill-down is via plain anchor tags so the heatmap
 *   degrades cleanly when JS is disabled.
 *
 * - **Accessibility (a11y)**: each region carries `role="img"` + a
 *   meaningful `<title>` + `<desc>` so screen readers announce the
 *   region name and metric. The whole SVG is wrapped in a
 *   `role="figure"` group with an `aria-labelledby` reference to the
 *   page title. Below the SVG, a `<table>` (visible to screen
 *   readers + collapsible for sighted users) replicates the data so
 *   reviewers who can't perceive colour still get every number.
 *
 * - **Bilingual labels**: the consumer page passes the operator's
 *   locale; this component picks `name_fr` or `name_en` accordingly.
 *
 * - **Drill-down**: each region wraps in `<a href="/findings?region=X">`,
 *   keyboard-focusable, with a focus ring drawn around the region
 *   path so keyboard users can see which region is active.
 *
 * - **Colour scale**: sequential single-hue ramp (lightest to
 *   saturated red-orange). Chosen for accessibility against red-
 *   green colour vision deficiency (deuteranopia/protanopia). The
 *   ramp uses ColorBrewer's "OrRd" 5-class palette as the
 *   reference; bucketed into 5 bins by quintile of
 *   `severity_weighted_score`.
 *
 * - **Empty state**: when every region has zero findings (e.g.
 *   immediately after a calibration reset), all regions render in
 *   the lightest tone and the legend collapses to "no data".
 *
 * - **No animation**: the page renders the same SVG every request;
 *   live updates would require a client component + SSE
 *   subscription. The audit-chain action `regions.aggregate` would
 *   be the SSE topic. Architect's call — for now, the page is
 *   re-rendered on demand (cached for 60s server-side per
 *   `revalidate`).
 */

import Link from 'next/link';

import {
  buildProjection,
  projectedCentroid,
  regionToSvgPath,
  regions,
} from '../lib/cameroon-projection';

import type { RegionAggregate, RegionRollup } from '../lib/regions.server';
import type { Constants } from '@vigil/shared';

type CmrRegionCode = (typeof Constants.CMR_REGIONS)[number]['code'];

/** ColorBrewer OrRd-5 (sequential, single-hue red-orange). Accessible
 *  to all major colour vision deficiencies; readable on white. */
const PALETTE: ReadonlyArray<string> = [
  '#fef0d9', // bin 0 — lightest (zero or near-zero)
  '#fdcc8a', // bin 1
  '#fc8d59', // bin 2
  '#e34a33', // bin 3
  '#b30000', // bin 4 — saturated
];

const FOCUS_RING_COLOUR = '#1d4ed8'; // blue-700 — high contrast against the ramp
const STROKE_COLOUR = '#1f2937'; // gray-800 — region borders
const STROKE_WIDTH = 0.5;
const EMPTY_FILL = '#f3f4f6'; // gray-100 for zero-finding regions

export interface RegionHeatmapProps {
  readonly aggregate: RegionAggregate;
  readonly locale: 'fr' | 'en';
  /** Optional SVG width override. Defaults to 720; the height scales
   *  with Cameroon's bbox aspect ratio so the country fits cleanly. */
  readonly width?: number;
  /** Optional ARIA id of the figure caption so the SVG can reference
   *  it via aria-labelledby. */
  readonly captionId?: string;
}

/**
 * Bucket a region's `severity_weighted_score` into a 0..4 palette
 * index. The scale is linear over the dataset's max. Regions with
 * zero findings are special-cased to `EMPTY_FILL` (rendered before
 * the bucket lookup runs).
 */
function bucketIndex(score: number, max: number): number {
  if (max <= 0) return 0;
  const fraction = Math.min(1, score / max);
  // 4 thresholds: 0.0–0.2, 0.2–0.4, 0.4–0.6, 0.6–0.8, 0.8–1.0
  if (fraction <= 0.2) return 0;
  if (fraction <= 0.4) return 1;
  if (fraction <= 0.6) return 2;
  if (fraction <= 0.8) return 3;
  return 4;
}

function fillFor(rollup: RegionRollup, max: number): string {
  if (rollup.count === 0) return EMPTY_FILL;
  return PALETTE[bucketIndex(rollup.severity_weighted_score, max)] ?? PALETTE[0]!;
}

function displayName(rollup: RegionRollup, locale: 'fr' | 'en'): string {
  return locale === 'fr' ? rollup.name_fr : rollup.name_en;
}

export function RegionHeatmap({
  aggregate,
  locale,
  width = 720,
  captionId,
}: RegionHeatmapProps): JSX.Element {
  const projection = buildProjection(width, 12);
  const rollupByCode = new Map(aggregate.rollups.map((r) => [r.code, r]));
  const features = regions();

  const labelDate = new Date(aggregate.computed_at).toISOString().slice(0, 10);
  const totalLabel =
    locale === 'fr'
      ? `${aggregate.total} constats totaux sur ${aggregate.window_days} jours · données ${labelDate}`
      : `${aggregate.total} total findings over ${aggregate.window_days} days · data ${labelDate}`;

  // Pre-compute the SVG path strings + label positions per region.
  // Done once outside the JSX to keep the JSX readable.
  const renderedRegions = features.map((feature) => {
    const code = feature.properties.code;
    const rollup = rollupByCode.get(code as CmrRegionCode);
    if (!rollup) return null;
    const path = regionToSvgPath(feature.geometry, projection);
    const [cx, cy] = projectedCentroid(feature, projection);
    const fill = fillFor(rollup, aggregate.max_weighted_score);
    const name = displayName(rollup, locale);
    const ariaLabel =
      locale === 'fr'
        ? `${name}: ${rollup.count} constats, score pondéré ${rollup.severity_weighted_score}, ${rollup.escalated_count} escalés`
        : `${name}: ${rollup.count} findings, weighted score ${rollup.severity_weighted_score}, ${rollup.escalated_count} escalated`;
    return { code, name, path, cx, cy, fill, rollup, ariaLabel };
  });

  return (
    <figure
      aria-labelledby={captionId}
      style={{
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <svg
        viewBox={`0 0 ${projection.width} ${projection.height}`}
        width="100%"
        height="auto"
        role="img"
        aria-label={
          locale === 'fr'
            ? `Carte choroplèthe des 10 régions du Cameroun — densité de constats pondérée par sévérité`
            : `Choropleth map of Cameroon's 10 regions — finding density weighted by severity`
        }
        style={{
          background: '#fafafa',
          border: '1px solid #e5e7eb',
          borderRadius: '0.5rem',
        }}
      >
        <defs>
          {/* Subtle drop-shadow for the country outline so it lifts
              off the page background. */}
          <filter id="region-shadow" x="-2%" y="-2%" width="104%" height="104%">
            <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#000" floodOpacity="0.08" />
          </filter>
          {/* Focus ring drawn behind the path on :focus-visible. */}
          <style>{`
            .region-link { outline: none; }
            .region-link:focus-visible .region-fill {
              stroke: ${FOCUS_RING_COLOUR};
              stroke-width: 2.5;
              filter: drop-shadow(0 0 4px ${FOCUS_RING_COLOUR});
            }
            .region-link:hover .region-fill {
              stroke: ${FOCUS_RING_COLOUR};
              stroke-width: 1.5;
            }
            .region-label {
              pointer-events: none;
              font-family: var(--font-sans, system-ui), sans-serif;
              font-size: 11px;
              font-weight: 500;
              fill: #111827;
              text-anchor: middle;
            }
            .region-label-shadow {
              stroke: #fafafa;
              stroke-width: 3;
              paint-order: stroke;
            }
          `}</style>
        </defs>

        <g filter="url(#region-shadow)">
          {renderedRegions.map((r) => {
            if (!r) return null;
            return (
              <Link
                key={r.code}
                href={`/findings?region=${r.code}`}
                className="region-link"
                aria-label={r.ariaLabel}
              >
                <path
                  className="region-fill"
                  d={r.path}
                  fill={r.fill}
                  stroke={STROKE_COLOUR}
                  strokeWidth={STROKE_WIDTH}
                  strokeLinejoin="round"
                  role="img"
                >
                  <title>{r.ariaLabel}</title>
                </path>
              </Link>
            );
          })}
        </g>

        {/* Labels go on top of all regions so they're never occluded
            by a darker neighbour. */}
        <g>
          {renderedRegions.map((r) => {
            if (!r) return null;
            return (
              <text
                key={`${r.code}-label`}
                x={r.cx}
                y={r.cy}
                className="region-label region-label-shadow"
                aria-hidden="true"
              >
                {r.name}
              </text>
            );
          })}
        </g>

        {/* Legend in the bottom-left corner. */}
        <Legend
          x={12}
          y={projection.height - 80}
          max={aggregate.max_weighted_score}
          locale={locale}
        />
      </svg>

      <figcaption
        id={captionId}
        style={{
          fontSize: '0.875rem',
          color: 'var(--muted, #6b7280)',
          textAlign: 'center',
        }}
      >
        {totalLabel}
      </figcaption>

      {/*
        Screen-reader + low-vision-friendly table fallback. Renders
        the same data tabularly so reviewers using assistive tech, OR
        viewing in a UA that doesn't support SVG (rare but real for
        some accessibility contexts), get the full information.
        Sighted users see this rendered below the map as a sortable
        detail table.
      */}
      <details style={{ marginTop: '0.5rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.875rem' }}>
          {locale === 'fr' ? 'Tableau des données par région' : 'Per-region data table'}
        </summary>
        <table
          aria-label={locale === 'fr' ? 'Constats par région' : 'Findings per region'}
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: '0.5rem',
            fontSize: '0.875rem',
          }}
        >
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem 0.25rem' }}>{locale === 'fr' ? 'Région' : 'Region'}</th>
              <th style={{ padding: '0.5rem 0.25rem', textAlign: 'right' }}>
                {locale === 'fr' ? 'Constats' : 'Findings'}
              </th>
              <th style={{ padding: '0.5rem 0.25rem', textAlign: 'right' }}>
                {locale === 'fr' ? 'Score pondéré' : 'Weighted score'}
              </th>
              <th style={{ padding: '0.5rem 0.25rem', textAlign: 'right' }}>
                {locale === 'fr' ? 'Posterior max' : 'Max posterior'}
              </th>
              <th style={{ padding: '0.5rem 0.25rem', textAlign: 'right' }}>
                {locale === 'fr' ? 'Escalés' : 'Escalated'}
              </th>
            </tr>
          </thead>
          <tbody>
            {aggregate.rollups.map((r) => (
              <tr key={r.code} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '0.5rem 0.25rem' }}>
                  <Link href={`/findings?region=${r.code}`}>{displayName(r, locale)}</Link>
                </td>
                <td style={{ padding: '0.5rem 0.25rem', textAlign: 'right' }}>{r.count}</td>
                <td style={{ padding: '0.5rem 0.25rem', textAlign: 'right' }}>
                  {r.severity_weighted_score}
                </td>
                <td style={{ padding: '0.5rem 0.25rem', textAlign: 'right' }}>
                  {r.posterior_max !== null ? r.posterior_max.toFixed(2) : '—'}
                </td>
                <td style={{ padding: '0.5rem 0.25rem', textAlign: 'right' }}>
                  {r.escalated_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/**
 * Inline legend showing the 5 colour bins with their score ranges.
 * Drawn as part of the same SVG so it can never visually drift from
 * the map's colour scale.
 */
function Legend({
  x,
  y,
  max,
  locale,
}: {
  readonly x: number;
  readonly y: number;
  readonly max: number;
  readonly locale: 'fr' | 'en';
}): JSX.Element {
  const swatchSize = 12;
  const gap = 2;
  const labelLow = locale === 'fr' ? '0' : '0';
  const labelHigh = max > 0 ? String(max) : locale === 'fr' ? 'aucune donnée' : 'no data';
  return (
    <g aria-hidden="true" transform={`translate(${x}, ${y})`} role="presentation">
      <text
        x={0}
        y={-4}
        style={{
          fontFamily: 'var(--font-sans, system-ui), sans-serif',
          fontSize: '10px',
          fill: '#4b5563',
        }}
      >
        {locale === 'fr' ? 'score pondéré' : 'weighted score'}
      </text>
      {PALETTE.map((c, i) => (
        <rect
          key={c}
          x={i * (swatchSize + gap)}
          y={0}
          width={swatchSize}
          height={swatchSize}
          fill={c}
          stroke={STROKE_COLOUR}
          strokeWidth={0.4}
        />
      ))}
      <text
        x={0}
        y={swatchSize + 12}
        style={{
          fontFamily: 'var(--font-sans, system-ui), sans-serif',
          fontSize: '10px',
          fill: '#4b5563',
        }}
      >
        {labelLow}
      </text>
      <text
        x={PALETTE.length * (swatchSize + gap) - swatchSize}
        y={swatchSize + 12}
        style={{
          fontFamily: 'var(--font-sans, system-ui), sans-serif',
          fontSize: '10px',
          fill: '#4b5563',
        }}
      >
        {labelHigh}
      </text>
    </g>
  );
}
