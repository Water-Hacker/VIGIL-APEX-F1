import 'server-only';

import { getDb } from '@vigil/db-postgres';
import { Constants } from '@vigil/shared';
import { sql } from 'drizzle-orm';

const { CMR_REGIONS } = Constants;
type CmrRegionCode = (typeof CMR_REGIONS)[number]['code'];

/**
 * Server-side aggregator for the national heatmap.
 *
 * Computes per-region rollups from `finding.finding`:
 *   - `count`: total findings in the time window (state ∈ open/review/
 *     escalated/closed; default window = last 90 days)
 *   - `severity_weighted_score`: weighted finding count by severity
 *     (low=1, medium=3, high=7, critical=15). Used as the choropleth
 *     fill metric — emphasises severity over raw count so a region
 *     with one CRITICAL finding ranks above a region with five LOW
 *     ones.
 *   - `posterior_max`: highest posterior in the window (drives a
 *     secondary "hot spot" badge on the legend)
 *   - `escalated_count`: subset that reached escalated/council_review
 *
 * The aggregator returns one row per region in `CMR_REGIONS` (10
 * total) — missing regions are filled with zeroes so the renderer
 * doesn't need to handle the absent case.
 *
 * Tier-5 RBAC reminder: the /regions page is operator-tier
 * (`operator`, `auditor`, `architect`). The middleware rule for
 * `/regions` is enforced separately.
 */

const SEVERITY_WEIGHTS: Readonly<Record<string, number>> = {
  low: 1,
  medium: 3,
  high: 7,
  critical: 15,
};

const WINDOW_DAYS_DEFAULT = 90;

export interface RegionRollup {
  readonly code: CmrRegionCode;
  readonly name_fr: string;
  readonly name_en: string;
  readonly count: number;
  readonly severity_weighted_score: number;
  readonly posterior_max: number | null;
  readonly escalated_count: number;
}

export interface RegionAggregate {
  readonly window_days: number;
  readonly computed_at: string;
  readonly total: number;
  readonly rollups: ReadonlyArray<RegionRollup>;
  /** The single largest weighted score across regions; drives the
   *  choropleth colour scale's upper bound so the strongest region
   *  always saturates the palette. */
  readonly max_weighted_score: number;
}

/**
 * Compute the full per-region rollup. Pure read; no writes.
 *
 * Falls back to synthetic data when `VIGIL_UI_ONLY=1` so a reviewer
 * runs `pnpm --filter dashboard run dev:ui-only` and sees the
 * heatmap populated.
 */
export async function aggregateByRegion(
  opts: { windowDays?: number } = {},
): Promise<RegionAggregate> {
  const windowDays = opts.windowDays ?? WINDOW_DAYS_DEFAULT;

  // UI-only mode (operator clicks through the dashboard without a
  // real Postgres). Synthetic per-region distribution that exercises
  // every cell of the choropleth (low, medium, high, saturated). The
  // distribution is deterministic so visual-regression CI stays
  // stable.
  if (process.env.VIGIL_UI_ONLY === '1') {
    return synthAggregate(windowDays);
  }

  const db = await getDb();
  const r = await db.execute(sql`
    SELECT region,
           severity,
           COUNT(*)::int                                                         AS n,
           MAX(posterior)                                                        AS posterior_max,
           SUM(CASE WHEN state IN ('escalated','council_review') THEN 1 ELSE 0 END)::int AS escalated
      FROM finding.finding
     WHERE detected_at >= NOW() - (${windowDays}::int * INTERVAL '1 day')
       AND region IS NOT NULL
       AND state IN ('detected','review','council_review','escalated','closed')
     GROUP BY region, severity
  `);

  // Accumulate per-region from the (region, severity) tuples.
  const acc = new Map<string, { count: number; weighted: number; pmax: number; esc: number }>();
  for (const row of r.rows) {
    const region = String(row['region']);
    const severity = String(row['severity']);
    const n = Number(row['n'] ?? 0);
    const pmax = row['posterior_max'] !== null ? Number(row['posterior_max']) : 0;
    const esc = Number(row['escalated'] ?? 0);
    const w = SEVERITY_WEIGHTS[severity] ?? 1;
    const existing = acc.get(region) ?? { count: 0, weighted: 0, pmax: 0, esc: 0 };
    existing.count += n;
    existing.weighted += n * w;
    existing.pmax = Math.max(existing.pmax, pmax);
    existing.esc += esc;
    acc.set(region, existing);
  }

  const rollups: RegionRollup[] = CMR_REGIONS.map((r) => {
    const a = acc.get(r.code);
    return {
      code: r.code,
      name_fr: r.nameFr,
      name_en: r.nameEn,
      count: a?.count ?? 0,
      severity_weighted_score: a?.weighted ?? 0,
      posterior_max: a?.pmax && a.pmax > 0 ? a.pmax : null,
      escalated_count: a?.esc ?? 0,
    };
  });

  const total = rollups.reduce((sum, r) => sum + r.count, 0);
  const maxWeighted = rollups.reduce((m, r) => Math.max(m, r.severity_weighted_score), 0);

  return {
    window_days: windowDays,
    computed_at: new Date().toISOString(),
    total,
    rollups,
    max_weighted_score: maxWeighted,
  };
}

/**
 * Synthetic aggregate for `VIGIL_UI_ONLY=1`. Deterministic
 * distribution chosen so the choropleth shows the full colour
 * range — saturated, mid, low, and a couple of zero-finding
 * regions to verify the empty-cell rendering.
 */
function synthAggregate(windowDays: number): RegionAggregate {
  const synth: ReadonlyArray<{
    code: CmrRegionCode;
    count: number;
    weighted: number;
    pmax: number;
    esc: number;
  }> = [
    { code: 'CE', count: 23, weighted: 198, pmax: 0.93, esc: 4 },
    { code: 'LT', count: 17, weighted: 142, pmax: 0.88, esc: 3 },
    { code: 'OU', count: 9, weighted: 58, pmax: 0.74, esc: 1 },
    { code: 'NO', count: 7, weighted: 49, pmax: 0.71, esc: 1 },
    { code: 'EN', count: 12, weighted: 87, pmax: 0.81, esc: 2 },
    { code: 'AD', count: 4, weighted: 16, pmax: 0.62, esc: 0 },
    { code: 'ES', count: 3, weighted: 11, pmax: 0.58, esc: 0 },
    { code: 'SU', count: 6, weighted: 38, pmax: 0.69, esc: 0 },
    { code: 'SW', count: 2, weighted: 5, pmax: 0.54, esc: 0 },
    { code: 'NW', count: 0, weighted: 0, pmax: 0, esc: 0 },
  ];
  const rollups: RegionRollup[] = CMR_REGIONS.map((r) => {
    const s = synth.find((x) => x.code === r.code);
    return {
      code: r.code,
      name_fr: r.nameFr,
      name_en: r.nameEn,
      count: s?.count ?? 0,
      severity_weighted_score: s?.weighted ?? 0,
      posterior_max: s && s.pmax > 0 ? s.pmax : null,
      escalated_count: s?.esc ?? 0,
    };
  });
  const total = rollups.reduce((sum, r) => sum + r.count, 0);
  const max = rollups.reduce((m, r) => Math.max(m, r.severity_weighted_score), 0);
  return {
    window_days: windowDays,
    computed_at: '2026-05-17T12:00:00.000Z',
    total,
    rollups,
    max_weighted_score: max,
  };
}
