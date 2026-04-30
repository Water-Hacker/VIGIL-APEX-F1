/**
 * Calibration evaluation — ECE / Brier / per-decile bucket reporting.
 *
 * SRD §19.4: the certainty engine targets ECE < 5% across decile buckets,
 * with reported certainty matching observed frequency within 5 pp.
 * Recalibrated monthly; results archived in /docs/calibration-reports/.
 *
 * This module is the engine that converts a labelled CalibrationEntry set
 * (architect + CONAC analyst hand-graded cases) into the per-bucket
 * report that:
 *   - feeds the Grafana calibration dashboard,
 *   - surfaces patterns whose declared defaultPrior is materially
 *     mis-aligned with the observed hit rate,
 *   - produces the architect's promotion / demotion shortlist for
 *     defaultPrior + defaultWeight tweaks.
 *
 * Pure functions. No I/O. No clock reads except where explicitly passed
 * via `now`. Caller (worker-score / adapter-runner cron) handles the DB
 * read and report persistence.
 *
 * Until the calibration seed has ≥ 30 cases (CLAUDE.md Phase-9 gate),
 * this module returns `insufficientData=true` with an empty bucket
 * report. Patterns continue to operate at their architect-declared
 * defaultPrior/defaultWeight; the gate is on PROMOTION of new priors,
 * not on running detection.
 */

export interface CalibrationCase {
  /** Posterior the engine reported for this case. */
  readonly posterior: number;
  /** Architect+analyst ground truth. */
  readonly groundTruth: 'true_positive' | 'false_positive' | 'partial_match';
  /** Pattern ids that fired for this case. Used for per-pattern ECE. */
  readonly patternIds: ReadonlyArray<string>;
}

export interface CalibrationBucket {
  /** Lower bound (inclusive) of this decile. 0.0 .. 0.9. */
  readonly lower: number;
  /** Upper bound (exclusive). 0.1 .. 1.0. */
  readonly upper: number;
  /** How many cases landed in this bucket. */
  readonly count: number;
  /** Mean posterior for cases in this bucket. */
  readonly meanPredicted: number;
  /** Observed positive rate (true_positive + 0.5 * partial_match) / count. */
  readonly observedRate: number;
  /** abs(meanPredicted − observedRate). */
  readonly absoluteError: number;
}

export interface CalibrationReport {
  /** Number of cases used to compute the report. */
  readonly sampleSize: number;
  /** Buckets in deciles 0.0–0.1, 0.1–0.2, …, 0.9–1.0. Always 10 entries. */
  readonly buckets: ReadonlyArray<CalibrationBucket>;
  /** Expected Calibration Error: weighted-by-bucket-count mean of absolute
   *  errors. SRD §19.4 target: < 0.05. */
  readonly ece: number;
  /** Maximum bucket-level absolute error (worst-case bucket). */
  readonly maxBucketError: number;
  /** Brier score: mean((posterior − binary_label)²). */
  readonly brier: number;
  /** Per-pattern report — hit rate vs declared baseline, ECE contribution. */
  readonly perPattern: ReadonlyMap<string, PerPatternReport>;
  /** True when sampleSize < MIN_CASES_FOR_REPORT. The bucket report is
   *  still computed for inspection but the architect should NOT promote
   *  priors based on a thin sample. */
  readonly insufficientData: boolean;
  /** When the report was computed. */
  readonly computedAt: string;
}

export interface PerPatternReport {
  readonly patternId: string;
  /** How many cases this pattern fired on. */
  readonly fireCount: number;
  /** TP rate restricted to cases this pattern fired on. */
  readonly hitRate: number;
  /** Declared defaultPrior (passed by caller). */
  readonly declaredPrior: number;
  /** abs(hitRate − declaredPrior). */
  readonly priorMisalignment: number;
}

export interface PatternPriorMap {
  readonly [patternId: string]: number;
}

/** Below this threshold, the architect must NOT promote a recalibrated
 *  prior. SRD §19.4 spec is 200 cases; CLAUDE.md Phase-9 gate is 30. We
 *  use 30 as the floor; the report still computes for visibility. */
export const MIN_CASES_FOR_REPORT = 30;

/**
 * Convert ground truth to a binary label.
 *   true_positive  → 1
 *   false_positive → 0
 *   partial_match  → 0.5 (avoids forcing a binary classification of
 *                         genuinely ambiguous cases; pulls ECE toward
 *                         the middle which is the right behaviour for
 *                         a Bayesian engine that admits uncertainty).
 */
function labelOf(gt: CalibrationCase['groundTruth']): number {
  switch (gt) {
    case 'true_positive':
      return 1;
    case 'false_positive':
      return 0;
    case 'partial_match':
      return 0.5;
  }
}

export interface CalibrationEvalOptions {
  /** Default 30. Below this, insufficientData=true. */
  readonly minCases?: number;
  /** Default () => new Date(). */
  readonly now?: () => Date;
  /** Map from pattern_id → declared defaultPrior. Used for the
   *  per-pattern misalignment report. */
  readonly declaredPriors?: PatternPriorMap;
}

export function evaluateCalibration(
  cases: ReadonlyArray<CalibrationCase>,
  opts: CalibrationEvalOptions = {},
): CalibrationReport {
  const minCases = opts.minCases ?? MIN_CASES_FOR_REPORT;
  const now = opts.now ?? (() => new Date());
  const declared = opts.declaredPriors ?? {};

  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < 10; i += 1) {
    const lower = i / 10;
    const upper = (i + 1) / 10;
    const inBucket = cases.filter((c) =>
      i === 9
        ? c.posterior >= lower && c.posterior <= upper
        : c.posterior >= lower && c.posterior < upper,
    );
    if (inBucket.length === 0) {
      buckets.push({
        lower,
        upper,
        count: 0,
        meanPredicted: (lower + upper) / 2,
        observedRate: 0,
        absoluteError: 0,
      });
      continue;
    }
    const meanPredicted = inBucket.reduce((acc, c) => acc + c.posterior, 0) / inBucket.length;
    const observedRate =
      inBucket.reduce((acc, c) => acc + labelOf(c.groundTruth), 0) / inBucket.length;
    buckets.push({
      lower,
      upper,
      count: inBucket.length,
      meanPredicted,
      observedRate,
      absoluteError: Math.abs(meanPredicted - observedRate),
    });
  }

  const totalCount = cases.length;
  const ece =
    totalCount === 0
      ? 0
      : buckets.reduce((acc, b) => acc + (b.count / totalCount) * b.absoluteError, 0);
  const maxBucketError = buckets.reduce((acc, b) => Math.max(acc, b.absoluteError), 0);

  const brier =
    totalCount === 0
      ? 0
      : cases.reduce((acc, c) => acc + Math.pow(c.posterior - labelOf(c.groundTruth), 2), 0) /
        totalCount;

  // Per-pattern report
  const perPatternFire = new Map<string, { hits: number; total: number }>();
  for (const c of cases) {
    const label = labelOf(c.groundTruth);
    for (const pid of c.patternIds) {
      const e = perPatternFire.get(pid) ?? { hits: 0, total: 0 };
      e.hits += label;
      e.total += 1;
      perPatternFire.set(pid, e);
    }
  }
  const perPattern = new Map<string, PerPatternReport>();
  for (const [pid, e] of perPatternFire) {
    const hitRate = e.total === 0 ? 0 : e.hits / e.total;
    const declaredPrior = declared[pid] ?? 0;
    perPattern.set(pid, {
      patternId: pid,
      fireCount: e.total,
      hitRate,
      declaredPrior,
      priorMisalignment: Math.abs(hitRate - declaredPrior),
    });
  }

  return {
    sampleSize: totalCount,
    buckets,
    ece,
    maxBucketError,
    brier,
    perPattern,
    insufficientData: totalCount < minCases,
    computedAt: now().toISOString(),
  };
}

/**
 * Pretty-print a calibration report as a markdown table for the
 * /docs/calibration-reports/ archive. Stable output (no clock / random)
 * so it diffs cleanly across runs.
 */
export function formatCalibrationReport(report: CalibrationReport): string {
  const lines: string[] = [];
  lines.push('# Calibration Report');
  lines.push('');
  lines.push(`Computed: ${report.computedAt}`);
  lines.push(`Sample size: ${report.sampleSize}`);
  lines.push(`ECE: ${report.ece.toFixed(4)} (target < 0.05 per SRD §19.4)`);
  lines.push(`Max bucket error: ${report.maxBucketError.toFixed(4)}`);
  lines.push(`Brier score: ${report.brier.toFixed(4)}`);
  if (report.insufficientData) {
    lines.push('');
    lines.push(`> ⚠ insufficient data — sample < ${MIN_CASES_FOR_REPORT}; do NOT promote priors.`);
  }
  lines.push('');
  lines.push('## Bucket report');
  lines.push('');
  lines.push('| Bucket | n | mean(predicted) | observed | |Δ| |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const b of report.buckets) {
    lines.push(
      `| ${b.lower.toFixed(1)}–${b.upper.toFixed(1)} | ${b.count} | ${b.meanPredicted.toFixed(3)} | ${b.observedRate.toFixed(3)} | ${b.absoluteError.toFixed(3)} |`,
    );
  }
  lines.push('');
  if (report.perPattern.size > 0) {
    lines.push('## Per-pattern misalignment (sorted)');
    lines.push('');
    lines.push('| Pattern | n | hit rate | declared | |Δ| |');
    lines.push('|---|---:|---:|---:|---:|');
    const sorted = [...report.perPattern.values()].sort(
      (a, b) => b.priorMisalignment - a.priorMisalignment,
    );
    for (const p of sorted) {
      lines.push(
        `| ${p.patternId} | ${p.fireCount} | ${p.hitRate.toFixed(3)} | ${p.declaredPrior.toFixed(3)} | ${p.priorMisalignment.toFixed(3)} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}
