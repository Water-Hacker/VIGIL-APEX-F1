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

export function bayesianPosterior(
  signals: ReadonlyArray<BayesianSignal>,
  opts: BayesianOptions = {},
): number {
  if (signals.length === 0) return 0;

  // Take the prior of the highest-prior contributing pattern as the base
  const basePrior = Math.max(...signals.map((s) => s.prior));
  let lo = logOdds(basePrior);

  // Build a quick lookup for damping
  const damping = opts.correlationDamping ?? 0.5;
  const correlated = new Set<string>();
  for (const [a, b] of opts.correlatedPairs ?? []) correlated.add(`${a}|${b}`);

  const seen = new Set<string>();
  for (const s of signals) {
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
  readonly outcome: 0 | 1;    // ground truth: 0 = false positive, 1 = true positive
}

export function expectedCalibrationError(data: ReadonlyArray<CalibrationDatum>, bins = 10): number {
  if (data.length === 0) return 0;
  const buckets: { sum: number; count: number; tp: number }[] = Array.from({ length: bins }, () => ({
    sum: 0,
    count: 0,
    tp: 0,
  }));
  for (const d of data) {
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
    ece += (b.count / data.length) * Math.abs(meanPred - obsRate);
  }
  return ece;
}

/** Brier score — mean squared error of probabilistic predictions. */
export function brierScore(data: ReadonlyArray<CalibrationDatum>): number {
  if (data.length === 0) return 0;
  let s = 0;
  for (const d of data) s += (d.predicted - d.outcome) ** 2;
  return s / data.length;
}

export function isPosteriorAboveEscalation(p: number): boolean {
  return p >= Constants.POSTERIOR_ESCALATION_THRESHOLD;
}
