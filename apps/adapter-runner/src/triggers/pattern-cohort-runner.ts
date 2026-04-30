/**
 * Pattern-cohort runner — nightly maintenance for the benchmark-price
 * service and the calibration evaluator.
 *
 * Two passes, each in its own try/catch so one failure does not stop
 * the other:
 *
 *   1. **Benchmark snapshot.** Walks every (procurement_method, region,
 *      year) bucket with ≥ MIN_BUCKET_SAMPLE awards, computes p25 /
 *      median / p75 in a single Postgres `percentile_cont` query, and
 *      logs the report. The per-event lookup path
 *      (BenchmarkPriceRepo.lookup) does the same calculation on demand
 *      for fresh awards; this snapshot is the offline-friendly view
 *      for the dashboard.
 *
 *   2. **Calibration evaluation.** Reads every graded calibration
 *      entry, runs `evaluateCalibration()`, and persists the report.
 *      Below MIN_CASES_FOR_REPORT (=30 today) the report is still
 *      computed but flagged `insufficientData=true` so the architect
 *      cannot accidentally promote priors. Above the threshold, the
 *      report's per-pattern misalignment table flags which priors
 *      diverge from observed hit-rate.
 *
 * No I/O during the test suite — both passes use injected sinks.
 */
import { randomUUID } from 'node:crypto';

import {
  PatternRegistry,
  evaluateCalibration,
  formatCalibrationReport,
  type CalibrationCase,
  type PatternPriorMap,
} from '@vigil/patterns';

import type { BenchmarkPriceRepo, CalibrationRepo, Db } from '@vigil/db-postgres';

export interface PatternCohortLogger {
  info: (msg: string, ctx?: unknown) => void;
  warn: (msg: string, ctx?: unknown) => void;
  error: (msg: string, ctx?: unknown) => void;
}

export interface PatternCohortInput {
  readonly db: Db;
  readonly benchmarkRepo: BenchmarkPriceRepo;
  readonly calibrationRepo: CalibrationRepo;
  readonly logger: PatternCohortLogger;
}

export interface PatternCohortReport {
  readonly benchmarkBucketsRefreshed: number;
  readonly calibrationCasesEvaluated: number;
  readonly calibrationEce: number;
  readonly calibrationInsufficient: boolean;
  readonly markdownReport: string;
}

export async function runPatternCohort(input: PatternCohortInput): Promise<PatternCohortReport> {
  const { benchmarkRepo, calibrationRepo, logger } = input;

  // ---- Benchmark snapshot ------------------------------------------------
  let benchmarkBucketsRefreshed = 0;
  try {
    const buckets = await benchmarkRepo.listAllBuckets();
    benchmarkBucketsRefreshed = buckets.length;
    logger.info('pattern-cohort.benchmark-ok', { buckets: buckets.length });
  } catch (e) {
    logger.error('pattern-cohort.benchmark-failed', { err: String(e) });
  }

  // ---- Calibration evaluation -------------------------------------------
  let report;
  let cases: ReadonlyArray<CalibrationCase> = [];
  try {
    const graded = await calibrationRepo.listGraded(2000);
    cases = graded.map((row) => ({
      posterior: Number(row.posterior_at_review ?? 0),
      groundTruth: row.ground_truth as CalibrationCase['groundTruth'],
      patternIds: extractPatternIds(row),
    }));

    const declared: PatternPriorMap = Object.fromEntries(
      PatternRegistry.all().map((p) => [p.id, p.defaultPrior]),
    );

    report = evaluateCalibration(cases, { declaredPriors: declared });
    logger.info('pattern-cohort.calibration-ok', {
      sampleSize: report.sampleSize,
      ece: report.ece.toFixed(4),
      insufficientData: report.insufficientData,
    });
    // Persist the report row, matching the calibration.report schema.
    try {
      const perPatternJson: Record<string, unknown> = {};
      for (const [pid, p] of report.perPattern) {
        perPatternJson[pid] = {
          fire_count: p.fireCount,
          hit_rate: p.hitRate,
          declared_prior: p.declaredPrior,
          prior_misalignment: p.priorMisalignment,
        };
      }
      await calibrationRepo.insertReport({
        id: randomUUID(),
        computed_at: new Date(report.computedAt),
        window_days: 365,
        total_entries: cases.length,
        graded_entries: cases.length,
        ece_overall: report.ece,
        brier_overall: report.brier,
        per_pattern: perPatternJson,
      });
    } catch (e) {
      logger.warn('pattern-cohort.calibration-persist-failed', { err: String(e) });
    }
  } catch (e) {
    logger.error('pattern-cohort.calibration-failed', { err: String(e) });
    report = {
      sampleSize: 0,
      buckets: [],
      ece: 0,
      maxBucketError: 0,
      brier: 0,
      perPattern: new Map(),
      insufficientData: true,
      computedAt: new Date().toISOString(),
    };
  }

  return {
    benchmarkBucketsRefreshed,
    calibrationCasesEvaluated: cases.length,
    calibrationEce: report.ece,
    calibrationInsufficient: report.insufficientData,
    markdownReport: formatCalibrationReport(report),
  };
}

/**
 * Best-effort extraction of pattern_ids from a calibration entry's
 * jsonb evidence column. The schema stores evidence as an array of
 * `{type, ref}` records; pattern signals are tagged `type: 'pattern'`
 * with `ref` set to the pattern_id.
 */
function extractPatternIds(row: {
  ground_truth_evidence_json?: unknown;
  pattern_id?: string | null;
}): string[] {
  const out = new Set<string>();
  if (typeof row.pattern_id === 'string') out.add(row.pattern_id);
  const ev = row.ground_truth_evidence_json;
  if (Array.isArray(ev)) {
    for (const e of ev) {
      if (e && typeof e === 'object' && 'type' in e && 'ref' in e) {
        const item = e as { type: unknown; ref: unknown };
        if (item.type === 'pattern' && typeof item.ref === 'string') {
          out.add(item.ref);
        }
      }
    }
  }
  return [...out];
}
