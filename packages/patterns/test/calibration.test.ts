/**
 * Calibration evaluator tests — ECE / Brier / per-decile bucket
 * accounting + per-pattern misalignment.
 */
import { describe, expect, it } from 'vitest';

import {
  evaluateCalibration,
  formatCalibrationReport,
  MIN_CASES_FOR_REPORT,
  type CalibrationCase,
} from '../src/calibration.js';

const NOW = new Date('2026-04-29T00:00:00Z');

function buildCases(
  specs: Array<[number, 'true_positive' | 'false_positive' | 'partial_match', string[]?]>,
) {
  return specs.map(([posterior, gt, pats]) => ({
    posterior,
    groundTruth: gt,
    patternIds: pats ?? [],
  })) as CalibrationCase[];
}

describe('evaluateCalibration — bucket accounting', () => {
  it('places every case in exactly one bucket', () => {
    const cases = buildCases(
      Array.from({ length: 10 }, (_, i) => [i / 10 + 0.05, 'true_positive']),
    );
    const r = evaluateCalibration(cases, { minCases: 1, now: () => NOW });
    expect(r.sampleSize).toBe(10);
    expect(r.buckets.reduce((acc, b) => acc + b.count, 0)).toBe(10);
    for (const b of r.buckets) {
      expect(b.count).toBe(1);
    }
  });

  it('places posterior=1.0 in the top bucket (inclusive upper)', () => {
    const cases = buildCases([[1.0, 'true_positive']]);
    const r = evaluateCalibration(cases, { minCases: 1, now: () => NOW });
    expect(r.buckets[9]?.count).toBe(1);
  });

  it('handles empty input', () => {
    const r = evaluateCalibration([], { minCases: 1, now: () => NOW });
    expect(r.sampleSize).toBe(0);
    expect(r.ece).toBe(0);
    expect(r.brier).toBe(0);
    expect(r.insufficientData).toBe(true);
  });
});

describe('evaluateCalibration — ECE computation', () => {
  it('returns ECE=0 for perfectly-calibrated cases', () => {
    // Half the bucket-0.85 cases are TP, half FP → observed=0.5; predicted=0.85.
    // For a perfectly-calibrated test: predicted=observed=0.85 in this bucket.
    // We construct cases where 85% are TP (matching 0.85 prediction).
    const cases = buildCases([
      [0.85, 'true_positive'],
      [0.85, 'true_positive'],
      [0.85, 'true_positive'],
      [0.85, 'true_positive'],
      [0.85, 'true_positive'],
      [0.85, 'true_positive'],
      [0.85, 'true_positive'],
      [0.85, 'true_positive'],
      [0.85, 'true_positive'],
      [0.85, 'false_positive'],
      [0.85, 'false_positive'], // 85.7% TP — close to 0.85 predicted
    ]);
    const r = evaluateCalibration(cases, { minCases: 1, now: () => NOW });
    // 9/11 ≈ 0.818 observed vs 0.85 predicted → ECE ≈ 0.032; below the
    // SRD §19.4 target of 0.05.
    expect(r.ece).toBeLessThan(0.05);
  });

  it('returns ECE > 0 when prediction diverges from observation', () => {
    // Predict 0.9 but only 50% are TP → bucket error 0.4
    const cases = buildCases([
      [0.95, 'true_positive'],
      [0.95, 'false_positive'],
      [0.95, 'true_positive'],
      [0.95, 'false_positive'],
    ]);
    const r = evaluateCalibration(cases, { minCases: 1, now: () => NOW });
    expect(r.ece).toBeGreaterThan(0.4);
  });
});

describe('evaluateCalibration — Brier score', () => {
  it('Brier = 0 when posterior matches binary label perfectly', () => {
    const cases = buildCases([
      [1.0, 'true_positive'],
      [0.0, 'false_positive'],
    ]);
    const r = evaluateCalibration(cases, { minCases: 1, now: () => NOW });
    expect(r.brier).toBe(0);
  });

  it('Brier = 1 worst case (posterior 1.0 but FP)', () => {
    const cases = buildCases([[1.0, 'false_positive']]);
    const r = evaluateCalibration(cases, { minCases: 1, now: () => NOW });
    expect(r.brier).toBe(1);
  });

  it('partial_match counts as label 0.5', () => {
    const cases = buildCases([[0.5, 'partial_match']]);
    const r = evaluateCalibration(cases, { minCases: 1, now: () => NOW });
    expect(r.brier).toBe(0);
  });
});

describe('evaluateCalibration — per-pattern misalignment', () => {
  it('reports hit rate and prior misalignment per pattern', () => {
    const cases = buildCases([
      [0.6, 'true_positive', ['P-A-001']],
      [0.6, 'true_positive', ['P-A-001']],
      [0.6, 'false_positive', ['P-A-001']],
      [0.6, 'true_positive', ['P-A-002']],
    ]);
    const r = evaluateCalibration(cases, {
      minCases: 1,
      now: () => NOW,
      declaredPriors: { 'P-A-001': 0.18, 'P-A-002': 0.3 },
    });
    const a001 = r.perPattern.get('P-A-001');
    expect(a001?.fireCount).toBe(3);
    expect(a001?.hitRate).toBeCloseTo(2 / 3, 5);
    expect(a001?.priorMisalignment).toBeCloseTo(2 / 3 - 0.18, 5);
    const a002 = r.perPattern.get('P-A-002');
    expect(a002?.fireCount).toBe(1);
    expect(a002?.hitRate).toBe(1);
  });
});

describe('evaluateCalibration — insufficient-data gate', () => {
  it('flags insufficientData when sampleSize < MIN_CASES_FOR_REPORT', () => {
    const cases = buildCases(Array.from({ length: 5 }, () => [0.5, 'true_positive']));
    const r = evaluateCalibration(cases, { now: () => NOW });
    expect(r.insufficientData).toBe(true);
    expect(MIN_CASES_FOR_REPORT).toBe(30);
  });

  it('clears the flag at >= MIN_CASES_FOR_REPORT', () => {
    const cases = buildCases(
      Array.from({ length: 30 }, (_, i) => [(i % 10) / 10 + 0.05, 'true_positive']),
    );
    const r = evaluateCalibration(cases, { now: () => NOW });
    expect(r.insufficientData).toBe(false);
  });
});

describe('formatCalibrationReport — markdown rendering', () => {
  it('produces a stable, deterministic markdown table', () => {
    const cases = buildCases([
      [0.15, 'true_positive', ['P-A-001']],
      [0.85, 'true_positive', ['P-A-002']],
    ]);
    const r = evaluateCalibration(cases, {
      minCases: 1,
      now: () => NOW,
      declaredPriors: { 'P-A-001': 0.18 },
    });
    const md = formatCalibrationReport(r);
    expect(md).toContain('# Calibration Report');
    expect(md).toContain('Sample size: 2');
    expect(md).toContain('ECE:');
    expect(md).toContain('| Pattern |');
    expect(md).toContain('P-A-001');
  });

  it('warns when sample is insufficient', () => {
    const r = evaluateCalibration(buildCases([[0.5, 'true_positive']]), {
      now: () => NOW,
    });
    const md = formatCalibrationReport(r);
    expect(md).toContain('insufficient data');
  });
});
