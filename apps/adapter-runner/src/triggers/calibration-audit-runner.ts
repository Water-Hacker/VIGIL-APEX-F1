import { randomUUID } from 'node:crypto';

import { HashChain } from '@vigil/audit-chain';
import {
  CalibrationAuditRepo,
  type Db,
} from '@vigil/db-postgres';
import { type Logger } from '@vigil/observability';
import { ENGINE_VERSION } from '@vigil/certainty-engine';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';

/**
 * AI-SAFETY-DOCTRINE-v1 §A.6 — quarterly calibration audit.
 *
 * Scans every `certainty.assessment` row whose finding has a known closure
 * outcome in the period (confirmed | cleared | dismissed | inconclusive),
 * groups them into reliability bands, computes predicted vs observed rates,
 * persists `calibration.audit_run` + `calibration.reliability_band` rows,
 * and anchors the run to the audit chain.
 *
 * The runner is idempotent on (period_label, engine_version) — re-running
 * a quarter regenerates the bands; the unique constraint on the run row
 * ensures we don't fork the audit history.
 */

export interface CalibrationRunnerDependencies {
  readonly db: Db;
  readonly pool: Pool;
  readonly audit: CalibrationAuditRepo;
  readonly logger: Logger;
  /** Allows tests to pin the period label / window. */
  readonly periodLabel: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

const BANDS: ReadonlyArray<{ label: string; min: number; max: number; midpoint: number }> = [
  { label: '0.95-1.00', min: 0.95, max: 1.0, midpoint: 0.975 },
  { label: '0.85-0.95', min: 0.85, max: 0.95, midpoint: 0.9 },
  { label: '0.80-0.85', min: 0.8, max: 0.85, midpoint: 0.825 },
  { label: '0.55-0.80', min: 0.55, max: 0.8, midpoint: 0.675 },
];

interface BandRow {
  label: string;
  min: number;
  max: number;
  midpoint: number;
  total: number;
  confirmed: number;
  cleared: number;
}

interface AssessmentJoinRow {
  posterior: string;
  closure_reason: string | null;
  primary_pattern_id: string | null;
}

export async function runCalibrationAudit(
  deps: CalibrationRunnerDependencies,
): Promise<{ runId: string; bandsWritten: number }> {
  const r = await deps.db.execute(sql`
    SELECT a.posterior_probability::text AS posterior,
           f.closure_reason,
           f.primary_pattern_id
      FROM certainty.assessment a
      JOIN finding.finding f ON f.id = a.finding_id
     WHERE a.computed_at >= ${deps.periodStart.toISOString()}::timestamptz
       AND a.computed_at <  ${deps.periodEnd.toISOString()}::timestamptz
       AND f.closed_at IS NOT NULL
  `);
  const rows = (r.rows as unknown as ReadonlyArray<AssessmentJoinRow>) ?? [];

  const bands: Map<string, BandRow> = new Map(
    BANDS.map((b) => [
      b.label,
      { ...b, total: 0, confirmed: 0, cleared: 0 } satisfies BandRow,
    ]),
  );
  const perPattern: Map<string, { total: number; confirmed: number }> = new Map();

  for (const row of rows) {
    const p = Number(row.posterior);
    const reason = row.closure_reason?.toLowerCase() ?? '';
    const confirmed = reason.includes('confirmed') || reason === 'escalated';
    const cleared = reason.includes('clear') || reason.includes('dismiss');
    for (const b of bands.values()) {
      if (p >= b.min && p < b.max + 1e-9) {
        b.total++;
        if (confirmed) b.confirmed++;
        if (cleared) b.cleared++;
        break;
      }
    }
    if (row.primary_pattern_id !== null) {
      const e = perPattern.get(row.primary_pattern_id) ?? { total: 0, confirmed: 0 };
      e.total++;
      if (confirmed) e.confirmed++;
      perPattern.set(row.primary_pattern_id, e);
    }
  }

  const runId = randomUUID();
  const perPatternGap: Record<string, number> = {};
  for (const [patternId, agg] of perPattern.entries()) {
    if (agg.total === 0) continue;
    const observed = agg.confirmed / agg.total;
    // Reference: a pattern with high LR (≥5) should have observed > 0.7 in
    // confirmed-after-action samples. Treat the absolute deviation from a
    // pattern-band-weighted prediction as the gap.
    const predicted = 0.85; // pattern-agnostic baseline; refined per future calibrations
    perPatternGap[patternId] = Math.abs(observed - predicted);
  }

  await deps.audit.createRun({
    id: runId,
    period_label: deps.periodLabel,
    period_start: deps.periodStart,
    period_end: deps.periodEnd,
    engine_version: ENGINE_VERSION,
    per_pattern_gap: perPatternGap,
    anchor_audit_event_id: null,
    computed_at: new Date(),
    signoff_architect: null,
    signoff_analyst: null,
    signoff_independent_reviewer: null,
  });

  let bandsWritten = 0;
  for (const b of bands.values()) {
    if (b.total === 0) continue;
    const observed = b.confirmed / b.total;
    const predicted = b.midpoint;
    const gap = Math.abs(observed - predicted);
    await deps.audit.recordBand({
      id: randomUUID(),
      audit_run_id: runId,
      band_label: b.label,
      band_min: b.min.toString(),
      band_max: b.max.toString(),
      predicted_rate: predicted.toString(),
      observed_rate: observed.toString(),
      finding_count: b.total,
      cleared_count: b.cleared,
      confirmed_count: b.confirmed,
      calibration_gap: gap.toString(),
    });
    bandsWritten++;
  }

  // Anchor the run id to the audit chain.
  try {
    const chain = new HashChain(deps.pool, deps.logger);
    const ev = await chain.append({
      action: 'system.health_degraded',
      actor: 'system:calibration-audit-runner',
      subject_kind: 'calibration_entry',
      subject_id: runId,
      payload: {
        period_label: deps.periodLabel,
        engine_version: ENGINE_VERSION,
        bands_written: bandsWritten,
        per_pattern_gap: perPatternGap,
      },
    });
    void ev;
  } catch (err) {
    deps.logger.warn({ err }, 'calibration-audit-anchor-failed');
  }

  deps.logger.info(
    {
      runId,
      periodLabel: deps.periodLabel,
      bandsWritten,
      flaggedPatterns: Object.entries(perPatternGap).filter(([, v]) => v >= 0.05).length,
    },
    'calibration-audit-completed',
  );

  return { runId, bandsWritten };
}

/** Helper: re-exported from quarter-window.js so callers that already import
 *  it from this module continue to work. */
export { currentQuarterWindow } from './quarter-window.js';
