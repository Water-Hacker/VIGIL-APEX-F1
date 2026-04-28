import 'server-only';

import { getDb } from '@vigil/db-postgres';
import { sql } from 'drizzle-orm';

export interface CalibrationView {
  readonly latest: {
    readonly computed_at: string;
    readonly window_days: number;
    readonly total_entries: number;
    readonly graded_entries: number;
    readonly ece_overall: number;
    readonly brier_overall: number;
    readonly per_pattern: ReadonlyArray<{
      pattern_id: string;
      ece: number;
      hit_rate: number;
      n: number;
    }>;
  } | null;
  readonly recent: ReadonlyArray<{
    readonly computed_at: string;
    readonly ece_overall: number;
  }>;
}

export async function getCalibrationView(): Promise<CalibrationView> {
  const db = await getDb();

  const latestRes = await db.execute(sql`
    SELECT computed_at::text, window_days, total_entries, graded_entries,
           ece_overall, brier_overall, per_pattern
      FROM calibration.report
     ORDER BY computed_at DESC
     LIMIT 1
  `);

  const recentRes = await db.execute(sql`
    SELECT computed_at::text, ece_overall
      FROM calibration.report
     ORDER BY computed_at DESC
     LIMIT 30
  `);

  const latestRow = latestRes.rows[0];
  const latest = latestRow
    ? {
        computed_at: String(latestRow['computed_at']),
        window_days: Number(latestRow['window_days']),
        total_entries: Number(latestRow['total_entries']),
        graded_entries: Number(latestRow['graded_entries']),
        ece_overall: Number(latestRow['ece_overall']),
        brier_overall: Number(latestRow['brier_overall']),
        per_pattern: (latestRow['per_pattern'] as ReadonlyArray<{
          pattern_id: string;
          ece: number;
          hit_rate: number;
          n: number;
        }>) ?? [],
      }
    : null;

  return {
    latest,
    recent: recentRes.rows.map((r) => ({
      computed_at: String(r['computed_at']),
      ece_overall: Number(r['ece_overall']),
    })),
  };
}
