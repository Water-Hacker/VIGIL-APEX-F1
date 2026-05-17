import { Constants } from '@vigil/shared';

/**
 * Bayesian certainty engine — combines per-signal strengths into a posterior.
 *
 * Per SRD §19.2: naive Bayes baseline in log-odds with correlation damping
 * for known-correlated pairs. Numerical stability via log-odds.
 *
 * Inputs per signal:
 *   - prior: per-pattern category baseline (SRD §19.3)
 *   - strength: P(signal | fraud) calibrated weight in [0..1]
 *   - weight: down-weight if pattern is known-noisy
 *
 * Each signal contributes likelihood ratio:
 *   LR = (strength * weight) / (1 - strength * weight)
 *
 * Posterior log-odds = log-odds(prior) + Σ log(LR_i) - correlation_correction
 */

export interface BayesianSignal {
  readonly pattern_id: string | null;
  readonly prior: number;
  readonly strength: number;
  readonly weight: number;
}

export interface BayesianOptions {
  /** Correlated-pair damping in [0..1]; 0 = no correction, 1 = drop redundant signals. */
  readonly correlationDamping?: number;
  /** Known-correlated pairs (e.g. ['P-B-001','P-F-002']). */
  readonly correlatedPairs?: ReadonlyArray<readonly [string, string]>;
}

const EPS = 1e-9;
const clamp = (x: number, lo = EPS, hi = 1 - EPS): number => Math.min(hi, Math.max(lo, x));

const logOdds = (p: number): number => {
  const c = clamp(p);
  return Math.log(c / (1 - c));
};
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * Tier-7 audit closure: NaN/Infinity defense. A signal with non-finite
 * prior/strength/weight (e.g. from `Number(null) = NaN` at the DB-row
 * boundary, or `Number('bad') = NaN` from a malformed payload) would
 * propagate NaN through `Math.max`, `logOdds`, `Math.log`, and into the
 * final posterior — silently producing NaN scores that downstream
 * calibration cannot detect except by inspection.
 *
 * We filter non-finite signals at the entry boundary and clamp surviving
 * values into the legal [EPS, 1-EPS] range BEFORE the maths runs.
 * Filtering (not throwing) is intentional: a buggy pattern emitting one
 * bad signal shouldn't poison an entire subject's score, but the bad
 * signal MUST NOT contribute to the posterior either.
 */
function isCleanSignal(s: BayesianSignal): boolean {
  return (
    Number.isFinite(s.prior) &&
    Number.isFinite(s.strength) &&
    Number.isFinite(s.weight) &&
    s.prior > 0 &&
    s.prior < 1 &&
    s.strength >= 0 &&
    s.strength <= 1 &&
    s.weight >= 0 &&
    s.weight <= 1
  );
}

export function bayesianPosterior(
  signals: ReadonlyArray<BayesianSignal>,
  opts: BayesianOptions = {},
): number {
  const cleanSignals = signals.filter(isCleanSignal);
  if (cleanSignals.length === 0) return 0;

  // Take the prior of the highest-prior contributing pattern as the base.
  // basePrior is guaranteed finite because every cleanSignal has finite
  // prior; Math.max over finite values cannot produce NaN.
  const basePrior = Math.max(...cleanSignals.map((s) => s.prior));
  let lo = logOdds(basePrior);

  // Tier-59 audit closure — clamp damping to [0, 1]. Pre-fix, a
  // caller passing `correlationDamping: 1.5` produced `1 - damping =
  // -0.5`; `lr ** -0.5` INVERTS each redundant-pair's evidence
  // contribution (a strong positive signal becomes a strong
  // negative signal). Damping < 0 amplifies redundant signals
  // instead of dampening them. Both modes silently corrupt the
  // posterior. Clamp to the documented `[0, 1]` contract.
  const dampingRaw = opts.correlationDamping ?? 0.5;
  const damping = Number.isFinite(dampingRaw) ? Math.min(1, Math.max(0, dampingRaw)) : 0.5;
  const correlated = new Set<string>();
  for (const [a, b] of opts.correlatedPairs ?? []) {
    // Tier-59: also defend against tuple-shape drift (TS narrowing
    // lost at runtime). A pair where either side is non-string
    // would produce `${a}|${b}` with literal "undefined" — silently
    // matching the empty correlated set + no-op dampening.
    if (typeof a === 'string' && typeof b === 'string' && a.length > 0 && b.length > 0) {
      correlated.add(`${a}|${b}`);
    }
  }

  const seen = new Set<string>();
  for (const s of cleanSignals) {
    const adjusted = clamp(s.strength * s.weight);
    let lr = adjusted / (1 - adjusted);
    if (s.pattern_id) {
      for (const other of seen) {
        const k1 = `${s.pattern_id}|${other}`;
        const k2 = `${other}|${s.pattern_id}`;
        if (correlated.has(k1) || correlated.has(k2)) {
          lr = lr ** (1 - damping); // dampen evidence
        }
      }
      seen.add(s.pattern_id);
    }
    lo += Math.log(lr);
  }
  return clamp(sigmoid(lo));
}

/* =============================================================================
 * ECE — Expected Calibration Error (SRD §19.5)
 * ===========================================================================*/

export interface CalibrationDatum {
  readonly predicted: number; // posterior in [0..1]
  readonly outcome: 0 | 1; // ground truth: 0 = false positive, 1 = true positive
}

/**
 * Tier-7 audit closure: filter non-finite or out-of-range predictions
 * before bucketing. A NaN predicted value would index buckets[NaN] →
 * undefined → runtime crash on the `b.sum +=` step. A predicted < 0
 * or > 1 would skew the bin index. Filtering preserves the metric's
 * meaning over the surviving data without crashing on poisoned input.
 */
function isCleanDatum(d: CalibrationDatum): boolean {
  return (
    Number.isFinite(d.predicted) &&
    d.predicted >= 0 &&
    d.predicted <= 1 &&
    (d.outcome === 0 || d.outcome === 1)
  );
}

export function expectedCalibrationError(data: ReadonlyArray<CalibrationDatum>, bins = 10): number {
  const clean = data.filter(isCleanDatum);
  if (clean.length === 0) return 0;
  const buckets: { sum: number; count: number; tp: number }[] = Array.from(
    { length: bins },
    () => ({
      sum: 0,
      count: 0,
      tp: 0,
    }),
  );
  for (const d of clean) {
    const idx = Math.min(bins - 1, Math.floor(d.predicted * bins));
    const b = buckets[idx]!;
    b.sum += d.predicted;
    b.count += 1;
    b.tp += d.outcome;
  }
  let ece = 0;
  for (const b of buckets) {
    if (b.count === 0) continue;
    const meanPred = b.sum / b.count;
    const obsRate = b.tp / b.count;
    ece += (b.count / clean.length) * Math.abs(meanPred - obsRate);
  }
  return ece;
}

/** Brier score — mean squared error of probabilistic predictions. */
export function brierScore(data: ReadonlyArray<CalibrationDatum>): number {
  const clean = data.filter(isCleanDatum);
  if (clean.length === 0) return 0;
  let s = 0;
  for (const d of clean) s += (d.predicted - d.outcome) ** 2;
  return s / clean.length;
}

export function isPosteriorAboveEscalation(p: number): boolean {
  return p >= Constants.POSTERIOR_ESCALATION_THRESHOLD;
}
