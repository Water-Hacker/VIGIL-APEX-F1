import { desc, sql } from 'drizzle-orm';

import * as calSchema from '../schema/calibration.js';

import type { Db } from '../client.js';

export class CalibrationRepo {
  constructor(private readonly db: Db) {}

  async insert(row: typeof calSchema.entry.$inferInsert): Promise<void> {
    await this.db.insert(calSchema.entry).values(row);
  }

  async listGraded(limit = 1000) {
    return this.db
      .select()
      .from(calSchema.entry)
      .where(sql`ground_truth IN ('true_positive','false_positive','partial_match')`)
      .orderBy(desc(calSchema.entry.recorded_at))
      .limit(limit);
  }

  async insertReport(row: typeof calSchema.report.$inferInsert): Promise<void> {
    await this.db.insert(calSchema.report).values(row);
  }

  async latestReport() {
    const rows = await this.db
      .select()
      .from(calSchema.report)
      .orderBy(desc(calSchema.report.computed_at))
      .limit(1);
    return rows[0] ?? null;
  }
}
