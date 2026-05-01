import { randomUUID } from 'node:crypto';

import { CallRecordRepo, VerbatimAuditRepo, type Db } from '@vigil/db-postgres';
import { Safety } from '@vigil/llm';
import { type Logger } from '@vigil/observability';
import { sql } from 'drizzle-orm';

import { uniformSample } from './uniform-sample';

/**
 * AI-SAFETY-DOCTRINE-v1 §B.1 verbatim audit sampler.
 *
 * Runs daily. Picks 5 % of yesterday's `llm.call_record` rows whose
 * extracted output contained cited claims (we look up the assessment's
 * components via the `finding_id`). For each sampled claim, the originating
 * source field is fetched from `source.events.payload`, the verbatim quote
 * is searched, and a row is written to `llm.verbatim_audit_sample` with
 * `match_found = (quote in source field)`.
 *
 * `VerbatimAuditRepo.hallucinationRate(window)` reads from this table and
 * surfaces the rolling rate on the AI-Safety dashboard.
 */

export interface SamplerDependencies {
  readonly db: Db;
  readonly callRecords: CallRecordRepo;
  readonly verbatim: VerbatimAuditRepo;
  readonly logger: Logger;
  /** Sample fraction in [0, 1]; default 0.05 (5 %). */
  readonly fraction?: number;
  /** Window in hours; default 24. */
  readonly windowHours?: number;
}

interface CallRow {
  id: string;
  finding_id: string | null;
  called_at: Date;
}

interface AssessmentComponent {
  evidence_id: string;
  source_id: string | null;
  verbatim_quote: string | null;
  rationale: string;
}

const NORMALISE_RE = /\s+/g;
function normalise(s: string): string {
  return s.normalize('NFKC').replace(NORMALISE_RE, ' ').trim().toLowerCase();
}

export async function runVerbatimAuditSampler(
  deps: SamplerDependencies,
): Promise<{ sampled: number; matches: number; mismatches: number }> {
  const fraction = deps.fraction ?? 0.05;
  const since = new Date(Date.now() - (deps.windowHours ?? 24) * 3_600_000);
  const sinceIso = since.toISOString();

  const r = await deps.db.execute(sql`
    SELECT id, finding_id, called_at
      FROM llm.call_record
     WHERE called_at >= ${sinceIso}::timestamptz
       AND schema_valid = true
       AND canary_triggered = false
       AND finding_id IS NOT NULL
       AND prompt_name = 'extract.cited-claims'
  `);
  const allRows = (r.rows as unknown as ReadonlyArray<CallRow>) ?? [];
  if (allRows.length === 0) return { sampled: 0, matches: 0, mismatches: 0 };

  const sampleSize = Math.max(1, Math.ceil(allRows.length * fraction));
  const shuffled = uniformSample(allRows, sampleSize);

  let matches = 0;
  let mismatches = 0;
  for (const call of shuffled) {
    if (call.finding_id === null) continue;
    // Fetch the latest assessment's components for this finding.
    const a = await deps.db.execute(sql`
      SELECT components::jsonb AS components
        FROM certainty.assessment
       WHERE finding_id = ${call.finding_id}
       ORDER BY computed_at DESC
       LIMIT 1
    `);
    const components = ((a.rows[0]?.['components'] as AssessmentComponent[]) ?? []).filter(
      (c) => c.verbatim_quote !== null && c.source_id !== null,
    );
    if (components.length === 0) continue;

    // For each cited component, fetch the source event payload and
    // search for the quote.
    for (const c of components) {
      if (c.verbatim_quote === null || c.source_id === null) continue;
      const ev = await deps.db.execute(sql`
        SELECT payload::text AS payload
          FROM source.events
         WHERE source_id = ${c.source_id}
         ORDER BY observed_at DESC
         LIMIT 1
      `);
      const payloadText = (ev.rows[0]?.['payload'] as string) ?? '';
      const found = normalise(payloadText).includes(normalise(c.verbatim_quote));
      void Safety; // ensure side-effect import (registers prompt-registry)
      await deps.verbatim.record({
        id: randomUUID(),
        call_record_id: call.id,
        finding_id: call.finding_id,
        claim: c.rationale.slice(0, 2_000),
        source_record_id: c.source_id,
        verbatim_quote: c.verbatim_quote,
        match_found: found,
      });
      if (found) matches++;
      else mismatches++;
    }
  }
  deps.logger.info(
    { sampleSize, matches, mismatches, total: allRows.length, fraction },
    'verbatim-audit-sampler-tick',
  );
  return { sampled: sampleSize, matches, mismatches };
}
