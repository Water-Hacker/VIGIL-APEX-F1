import { sql } from 'drizzle-orm';

import type { Db } from '../client.js';

/**
 * Benchmark-price service.
 *
 * Pattern P-C-001 (price-above-benchmark) reads
 * `award.payload.benchmark_amount_xaf` to flag awards whose amount
 * exceeds the moving-median of comparable tenders by ≥30%. Patterns
 * P-C-002..P-C-006 use the same benchmark as a sanity reference.
 *
 * Definition of "comparable":
 *   - Same procurement_method (open vs restricted vs sole-source)
 *   - Same region
 *   - Same calendar year (rolling-12-month is preferable but year is
 *     the discrete bucket we fix for the v1; year boundary effects are
 *     dampened by the 30% threshold P-C-001 applies)
 *   - Excludes the award being benchmarked itself.
 *
 * Returns the median amount across the bucket. Median (not mean) per
 * SRD §19.6 — the engine prefers a robust statistic since procurement
 * data is frequently right-skewed by a handful of mega-projects.
 *
 * Hardening:
 *   - SQL is parameterised (no injection).
 *   - LIMIT 5000 caps the per-bucket sample.
 *   - Returns null when fewer than MIN_BUCKET_SAMPLE comparable tenders
 *     exist — the moving median is meaningless on a tiny sample. The
 *     extractor consumer treats null as "no benchmark available" and
 *     P-C-001's detect() short-circuits.
 *   - Pure read; never mutates.
 */

export interface BenchmarkLookupOptions {
  readonly procurementMethod: string | null;
  readonly region: string | null;
  readonly year: number;
  /** Awards from this source-event id are excluded from the benchmark.
   *  Prevents an award being its own benchmark when patterns load it
   *  in a tight loop after the extractor populates the field. */
  readonly excludeEventId?: string;
}

export interface BenchmarkResult {
  readonly bucketKey: string;
  readonly sampleCount: number;
  readonly medianXaf: number;
  readonly p25Xaf: number;
  readonly p75Xaf: number;
}

const MIN_BUCKET_SAMPLE = 5;

export class BenchmarkPriceRepo {
  constructor(private readonly db: Db) {}

  async lookup(opts: BenchmarkLookupOptions): Promise<BenchmarkResult | null> {
    if (!opts.procurementMethod || !opts.region) return null;
    // Pull the comparable amounts as a flat list.
    const rows = await this.db.execute(sql`
      SELECT (payload->>'amount_xaf')::bigint AS amount
      FROM source.events
      WHERE kind = 'award'
        AND payload->>'amount_xaf' ~ '^[0-9]+$'
        AND payload->>'procurement_method' = ${opts.procurementMethod}
        AND payload->>'region' = ${opts.region}
        AND EXTRACT(YEAR FROM observed_at) = ${opts.year}
        ${opts.excludeEventId ? sql`AND id != ${opts.excludeEventId}` : sql``}
      ORDER BY amount
      LIMIT 5000
    `);
    type Row = { amount: string | number | null };
    const list = (rows.rows as unknown as ReadonlyArray<Row>)
      .map((r) => Number(r.amount))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (list.length < MIN_BUCKET_SAMPLE) return null;
    return {
      bucketKey: `${opts.procurementMethod}|${opts.region}|${opts.year}`,
      sampleCount: list.length,
      medianXaf: percentile(list, 0.5),
      p25Xaf: percentile(list, 0.25),
      p75Xaf: percentile(list, 0.75),
    };
  }

  /**
   * Bulk benchmark refresh — recomputes every bucket's median + IQR and
   * writes one summary row per bucket to a materialised view-equivalent
   * table. Designed to be called nightly by adapter-runner cron.
   *
   * Called from: apps/adapter-runner/src/triggers/benchmark-price-runner.ts.
   * The job snapshots all (method, region, year) buckets that have ≥
   * MIN_BUCKET_SAMPLE awards, computes the per-bucket statistics, and
   * publishes them in a flat report the dashboard can render.
   */
  async listAllBuckets(): Promise<readonly BenchmarkResult[]> {
    // GROUP BY (method, region, year) and compute the percentiles via SQL.
    const rows = await this.db.execute(sql`
      WITH bucketed AS (
        SELECT
          payload->>'procurement_method' AS method,
          payload->>'region' AS region,
          EXTRACT(YEAR FROM observed_at)::int AS year,
          (payload->>'amount_xaf')::bigint AS amount
        FROM source.events
        WHERE kind = 'award'
          AND payload->>'amount_xaf' ~ '^[0-9]+$'
          AND payload->>'procurement_method' IS NOT NULL
          AND payload->>'region' IS NOT NULL
      )
      SELECT
        method,
        region,
        year,
        COUNT(*) AS n,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY amount) AS p25,
        percentile_cont(0.5)  WITHIN GROUP (ORDER BY amount) AS med,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY amount) AS p75
      FROM bucketed
      GROUP BY method, region, year
      HAVING COUNT(*) >= ${MIN_BUCKET_SAMPLE}
      ORDER BY method, region, year
    `);
    type Row = {
      method: string;
      region: string;
      year: number;
      n: string | number;
      p25: string | number;
      med: string | number;
      p75: string | number;
    };
    return (rows.rows as unknown as ReadonlyArray<Row>).map((r) => ({
      bucketKey: `${r.method}|${r.region}|${r.year}`,
      sampleCount: Number(r.n),
      medianXaf: Math.round(Number(r.med)),
      p25Xaf: Math.round(Number(r.p25)),
      p75Xaf: Math.round(Number(r.p75)),
    }));
  }
}

/**
 * Pure percentile helper for the in-memory list path.
 * Uses linear interpolation between the two surrounding indices.
 * Exposed so the runner trigger can compute additional percentiles
 * without re-querying.
 */
export function percentile(sortedAsc: ReadonlyArray<number>, q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (q <= 0) return sortedAsc[0]!;
  if (q >= 1) return sortedAsc[sortedAsc.length - 1]!;
  const idx = (sortedAsc.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = idx - lo;
  return Math.round(sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac);
}

export const BENCHMARK_MIN_BUCKET_SAMPLE = MIN_BUCKET_SAMPLE;
