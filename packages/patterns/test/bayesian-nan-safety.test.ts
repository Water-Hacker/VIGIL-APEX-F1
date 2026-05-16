/**
 * Tier-7 pattern engine audit — bayesianPosterior / ECE / Brier
 * NaN-safety closures.
 *
 * Pre-fix:
 *   - bayesianPosterior received signals untouched. A signal with a
 *     non-finite prior/strength/weight (Number(null) at the DB-row
 *     boundary, Number('bad') from a malformed payload, division-by-
 *     zero in a pattern's strength computation) would propagate NaN
 *     through Math.max → logOdds → Math.log into a NaN posterior.
 *     The worker-score caller at apps/worker-score/src/index.ts:101
 *     already discards the result as a "legacy sanity cross-check",
 *     so NaN doesn't reach production decisions today — but the
 *     function is exported as a public utility and any new caller
 *     would inherit the gap.
 *   - expectedCalibrationError indexed buckets[NaN] (undefined),
 *     crashing on the b.sum += line. brierScore returned NaN.
 *
 * Post-fix:
 *   - bayesianPosterior filters non-finite signals at entry.
 *   - ECE + Brier filter non-finite predictions before bucketing.
 *   - Filtering (not throwing) is intentional: a single buggy pattern
 *     shouldn't poison an entire subject's score; the bad signal
 *     simply does not contribute.
 */
import { describe, expect, it } from 'vitest';

import {
  bayesianPosterior,
  brierScore,
  expectedCalibrationError,
  type BayesianSignal,
  type CalibrationDatum,
} from '../src/bayesian.js';

describe('bayesianPosterior — NaN-safety closures', () => {
  it('filters a NaN strength signal and returns posterior over surviving signals', () => {
    const clean: BayesianSignal = { pattern_id: 'P-A-001', prior: 0.1, strength: 0.7, weight: 0.9 };
    const dirty: BayesianSignal = { pattern_id: 'P-A-002', prior: 0.1, strength: NaN, weight: 0.9 };
    const result = bayesianPosterior([clean, dirty]);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
    // Posterior should equal what we'd get from [clean] alone.
    const cleanOnly = bayesianPosterior([clean]);
    expect(result).toBeCloseTo(cleanOnly, 9);
  });

  it('filters Infinity weights', () => {
    const dirty: BayesianSignal = {
      pattern_id: 'P-A-001',
      prior: 0.1,
      strength: 0.5,
      weight: Infinity,
    };
    const result = bayesianPosterior([dirty]);
    expect(result).toBe(0); // no clean signals → 0
  });

  it('filters a signal whose prior is out-of-range (0 or 1 exactly)', () => {
    // logOdds(0) = -Infinity, logOdds(1) = +Infinity → posterior NaN
    // unless the signal is filtered. The clean-signal predicate
    // requires prior > 0 AND prior < 1.
    const dirtyZero: BayesianSignal = {
      pattern_id: 'P-A-001',
      prior: 0,
      strength: 0.5,
      weight: 0.5,
    };
    const dirtyOne: BayesianSignal = {
      pattern_id: 'P-A-002',
      prior: 1,
      strength: 0.5,
      weight: 0.5,
    };
    expect(bayesianPosterior([dirtyZero])).toBe(0);
    expect(bayesianPosterior([dirtyOne])).toBe(0);
  });

  it('filters strength > 1 or weight < 0', () => {
    const tooHighStrength: BayesianSignal = {
      pattern_id: 'P-A-001',
      prior: 0.1,
      strength: 1.5,
      weight: 0.9,
    };
    const negWeight: BayesianSignal = {
      pattern_id: 'P-A-002',
      prior: 0.1,
      strength: 0.5,
      weight: -0.1,
    };
    expect(bayesianPosterior([tooHighStrength])).toBe(0);
    expect(bayesianPosterior([negWeight])).toBe(0);
  });

  it('all-NaN input → returns 0 (not NaN) and never throws', () => {
    const allDirty: BayesianSignal[] = [
      { pattern_id: 'P-A-001', prior: NaN, strength: 0.5, weight: 0.5 },
      { pattern_id: 'P-A-002', prior: 0.1, strength: NaN, weight: 0.5 },
      { pattern_id: 'P-A-003', prior: 0.1, strength: 0.5, weight: NaN },
    ];
    const result = bayesianPosterior(allDirty);
    expect(result).toBe(0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('clean signals produce a finite posterior in (0, 1)', () => {
    // Sanity: the NaN-filter doesn't change clean-input behaviour.
    const signals: BayesianSignal[] = [
      { pattern_id: 'P-A-001', prior: 0.1, strength: 0.7, weight: 1 },
      { pattern_id: 'P-B-001', prior: 0.1, strength: 0.6, weight: 1 },
    ];
    const result = bayesianPosterior(signals);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
    expect(Number.isFinite(result)).toBe(true);
  });
});

describe('expectedCalibrationError — NaN-safety closures', () => {
  it('filters NaN predictions before bucketing (would otherwise crash on undefined bucket)', () => {
    const data: CalibrationDatum[] = [
      { predicted: 0.5, outcome: 1 },
      { predicted: NaN, outcome: 0 }, // pre-fix: indexes buckets[NaN] → undefined → crash
      { predicted: 0.7, outcome: 1 },
    ];
    const result = expectedCalibrationError(data);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('filters predictions outside [0, 1] (would skew bucket idx pre-fix)', () => {
    const data: CalibrationDatum[] = [
      { predicted: -0.1, outcome: 0 },
      { predicted: 1.5, outcome: 1 },
      { predicted: 0.5, outcome: 1 },
    ];
    const result = expectedCalibrationError(data);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('all-NaN input → returns 0 (not NaN)', () => {
    const data: CalibrationDatum[] = [
      { predicted: NaN, outcome: 0 },
      { predicted: Infinity, outcome: 1 },
    ];
    expect(expectedCalibrationError(data)).toBe(0);
  });

  it('clean input still produces a non-trivial ECE', () => {
    // 10 perfectly-miscalibrated points → ECE should be > 0.
    const data: CalibrationDatum[] = [
      { predicted: 0.1, outcome: 1 },
      { predicted: 0.2, outcome: 1 },
      { predicted: 0.9, outcome: 0 },
      { predicted: 0.95, outcome: 0 },
    ];
    const result = expectedCalibrationError(data);
    expect(result).toBeGreaterThan(0);
    expect(Number.isFinite(result)).toBe(true);
  });
});

describe('brierScore — NaN-safety closures', () => {
  it('filters NaN predictions (would otherwise produce NaN brier)', () => {
    const data: CalibrationDatum[] = [
      { predicted: 0.8, outcome: 1 },
      { predicted: NaN, outcome: 0 },
      { predicted: 0.2, outcome: 0 },
    ];
    const result = brierScore(data);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('all-NaN input → returns 0 (not NaN)', () => {
    expect(brierScore([{ predicted: NaN, outcome: 0 }])).toBe(0);
  });

  it('clean input — perfect predictions yield brier = 0', () => {
    const data: CalibrationDatum[] = [
      { predicted: 1, outcome: 1 },
      { predicted: 0, outcome: 0 },
    ];
    expect(brierScore(data)).toBe(0);
  });

  it('clean input — worst predictions yield brier = 1', () => {
    const data: CalibrationDatum[] = [
      { predicted: 0, outcome: 1 },
      { predicted: 1, outcome: 0 },
    ];
    expect(brierScore(data)).toBe(1);
  });
});
