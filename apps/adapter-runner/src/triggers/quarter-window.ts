/**
 * Pure helper — returns the current quarter's label and start/end timestamps.
 * Lives outside calibration-audit-runner.ts so importers (e.g. the TAL-PA
 * quarterly export trigger) don't need to drag the certainty-engine
 * dependency tree along.
 */
export function currentQuarterWindow(now: Date = new Date()): {
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
} {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0..11
  const q = Math.floor(m / 3) + 1;
  const startMonth = (q - 1) * 3;
  const periodStart = new Date(Date.UTC(y, startMonth, 1));
  const periodEnd = new Date(Date.UTC(y, startMonth + 3, 1));
  return {
    periodLabel: `${y}-Q${q}`,
    periodStart,
    periodEnd,
  };
}
