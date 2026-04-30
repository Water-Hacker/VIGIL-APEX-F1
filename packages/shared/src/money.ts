/**
 * Money helpers — XAF (Cameroonian franc) is the primary currency.
 *
 * Per BUILD-V1 §00 and EXEC §38 decision #10, XAF is the local accounting
 * currency; EUR/USD are used for international comparisons. We store amounts
 * as INTEGERS in the smallest-unit (XAF has no subdivision). Never floats.
 */

const XAF_PER_EUR_REFERENCE = 655.957; // CFA peg (FCFA-CEMAC-CFA → EUR fixed)
// USD/EUR is market-rate; we keep a slow-moving reference for sanity checks.
// Exact conversion at runtime fetches the daily fixing from BEAC if available.
const USD_PER_EUR_REFERENCE_2026 = 1.08;

export type Xaf = number & { readonly __brand: 'Xaf' };
export type Eur = number & { readonly __brand: 'Eur' };
export type Usd = number & { readonly __brand: 'Usd' };

// AUDIT-048: explicit safe-range ceiling for every money brand. The
// 1e15 limit is comfortably below Number.MAX_SAFE_INTEGER (~9e15) and
// gives ~30 decimal-orders-of-magnitude headroom over the largest
// realistic procurement contract (Cameroon 2026 budget total: ~5.6e12
// FCFA). Rejecting above-ceiling at construction time prevents a
// downstream f64-imprecision bug from corrupting an audit row.
export const MONEY_SAFE_CEILING = 1e15 as const;

export function asXaf(n: number): Xaf {
  if (!Number.isInteger(n)) throw new Error(`XAF must be an integer (smallest unit): ${n}`);
  if (n < -MONEY_SAFE_CEILING || n > MONEY_SAFE_CEILING) {
    throw new Error(`XAF out of safe range: ${n}`);
  }
  return n as Xaf;
}

export function asEurMinor(cents: number): Eur {
  if (!Number.isInteger(cents)) throw new Error(`EUR must be cents (integer): ${cents}`);
  if (cents < -MONEY_SAFE_CEILING || cents > MONEY_SAFE_CEILING) {
    throw new Error(`EUR out of safe range: ${cents}`);
  }
  return cents as Eur;
}

export function asUsdMinor(cents: number): Usd {
  if (!Number.isInteger(cents)) throw new Error(`USD must be cents (integer): ${cents}`);
  if (cents < -MONEY_SAFE_CEILING || cents > MONEY_SAFE_CEILING) {
    throw new Error(`USD out of safe range: ${cents}`);
  }
  return cents as Usd;
}

/** Reference conversion — for sanity checks, NOT for accounting. */
export function xafToEurReference(xaf: Xaf): Eur {
  return Math.round(((xaf as number) / XAF_PER_EUR_REFERENCE) * 100) as Eur;
}

export function eurToUsdReference(eur: Eur): Usd {
  return Math.round((eur as number) * USD_PER_EUR_REFERENCE_2026) as Usd;
}

/** Format XAF for FR-CM display ("4 250 000 FCFA"). Never used for storage. */
export function formatXaf(xaf: Xaf): string {
  return `${(xaf as number).toLocaleString('fr-CM', { useGrouping: true })} FCFA`;
}

/** Severity bands per SRD §06.4 / MVP §17.1. */
export type Severity = 'low' | 'medium' | 'high' | 'critical';

const SEV_THRESHOLDS_XAF: Record<Severity, [number, number]> = {
  low: [0, 50_000_000], // < 50 M XAF
  medium: [50_000_000, 200_000_000], // 50-200 M
  high: [200_000_000, 1_000_000_000], // 200 M - 1 B
  critical: [1_000_000_000, Number.POSITIVE_INFINITY], // ≥ 1 B
};

export function severityForXaf(xaf: Xaf): Severity {
  const v = xaf as number;
  for (const [sev, [lo, hi]] of Object.entries(SEV_THRESHOLDS_XAF) as Array<
    [Severity, [number, number]]
  >) {
    if (v >= lo && v < hi) return sev;
  }
  return 'critical';
}
