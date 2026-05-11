import { getDb } from '@vigil/db-postgres';
import { boundedBodyText, boundedRequest, createLogger, type Logger } from '@vigil/observability';
import { sql } from 'drizzle-orm';

import type { CandidateSelector } from './types.js';

const log = createLogger({ service: 'worker-adapter-repair-shadow' });

/**
 * Run the candidate selector against the live page once, comparing to
 * the old selector. Records one row per call into
 * `source.adapter_repair_shadow_log`. Auto-promotion logic runs
 * separately (`maybePromote`).
 *
 * `applyOld` and `applyNew` are caller-supplied shims that take a
 * page body string and return either the parsed event payload or
 * null on parse failure. Keeping them as parameters means this
 * module doesn't need to know about Cheerio / fast-xml-parser /
 * etc — those live in the adapter itself.
 */
export interface ShadowTestArgs {
  proposalId: string;
  sourceId: string;
  pageUrl: string;
  applyOld: (body: string) => unknown | null;
  applyNew: (body: string, candidate: CandidateSelector) => unknown | null;
  candidate: CandidateSelector;
}

export async function runShadowTest(args: ShadowTestArgs, logger: Logger = log): Promise<void> {
  const db = await getDb();

  let oldOutput: unknown | null = null;
  let newOutput: unknown | null = null;
  try {
    const r = await boundedRequest(args.pageUrl, { method: 'GET', maxRedirections: 5 });
    const body = await boundedBodyText(r.body, { sourceId: args.sourceId, url: args.pageUrl });
    oldOutput = args.applyOld(body);
    newOutput = args.applyNew(body, args.candidate);
  } catch (e) {
    logger.warn({ err: e, source: args.sourceId }, 'shadow-fetch-failed');
  }

  const oldMatch = oldOutput !== null && oldOutput !== undefined;
  const newMatch = newOutput !== null && newOutput !== undefined;
  const divergence =
    oldMatch && newMatch
      ? JSON.stringify(oldOutput) !== JSON.stringify(newOutput)
      : oldMatch !== newMatch;

  await db.execute(sql`
    INSERT INTO source.adapter_repair_shadow_log
      (proposal_id, ran_at, old_match, new_match, divergence)
    VALUES
      (${args.proposalId}::uuid, NOW(), ${oldMatch}, ${newMatch}, ${divergence})
  `);
}

/**
 * Auto-promotion rule (informational adapters only).
 *
 * Promote when:
 *   - >= 48 shadow rows exist
 *   - in the most recent 48 rows, divergence < 5%
 *   - new_match >= 90%
 *
 * Architect-decision recorded in the plan: critical adapters always
 * require manual sign-off, regardless of how clean the shadow log is.
 */
export async function maybePromote(
  proposalId: string,
  sourceId: string,
  isCritical: boolean,
  logger: Logger = log,
): Promise<'promoted' | 'awaiting_approval' | 'still_shadow'> {
  if (isCritical) {
    // Bump status from shadow_testing → awaiting_approval once the 48-window
    // budget is reached so the operator UI can list it.
    const db = await getDb();
    const r = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
        FROM source.adapter_repair_shadow_log
       WHERE proposal_id = ${proposalId}::uuid
    `);
    const count = Number(r.rows[0]?.count ?? 0);
    if (count >= 48) {
      await db.execute(sql`
        UPDATE source.adapter_repair_proposal
           SET status = 'awaiting_approval'
         WHERE id = ${proposalId}::uuid AND status = 'shadow_testing'
      `);
      logger.info({ proposalId, sourceId }, 'critical-adapter-awaiting-approval');
      return 'awaiting_approval';
    }
    return 'still_shadow';
  }

  const db = await getDb();
  const r = await db.execute<{
    rows: number;
    divergent: number;
    new_matches: number;
  }>(sql`
    SELECT COUNT(*)::int AS rows,
           SUM(CASE WHEN divergence THEN 1 ELSE 0 END)::int AS divergent,
           SUM(CASE WHEN new_match THEN 1 ELSE 0 END)::int  AS new_matches
      FROM (
        SELECT divergence, new_match
          FROM source.adapter_repair_shadow_log
         WHERE proposal_id = ${proposalId}::uuid
         ORDER BY ran_at DESC
         LIMIT 48
      ) recent
  `);
  const stats = r.rows[0];
  if (!stats || stats.rows < 48) return 'still_shadow';

  const divergenceRate = stats.divergent / stats.rows;
  const newMatchRate = stats.new_matches / stats.rows;
  if (divergenceRate < 0.05 && newMatchRate >= 0.9) {
    await db.execute(sql`
      UPDATE source.adapter_repair_proposal
         SET status = 'promoted', decided_at = NOW(), decided_by = 'auto-promotion',
             decision_reason = ${`divergence ${(divergenceRate * 100).toFixed(1)}% / new_match ${(newMatchRate * 100).toFixed(1)}%`}
       WHERE id = ${proposalId}::uuid AND status = 'shadow_testing'
    `);
    logger.info({ proposalId, sourceId, divergenceRate, newMatchRate }, 'adapter-auto-promoted');
    return 'promoted';
  }
  return 'still_shadow';
}
