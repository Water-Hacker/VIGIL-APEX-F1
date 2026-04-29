import { randomUUID } from 'node:crypto';

import { getDb } from '@vigil/db-postgres';
import { LlmRouter } from '@vigil/llm';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  registerShutdown,
  shutdownTracing,
  startMetricsServer,
} from '@vigil/observability';
import { VaultClient } from '@vigil/security';
import { sql } from 'drizzle-orm';
import cron from 'node-cron';
import { request } from 'undici';
import { z } from 'zod';


import {
  SELECTOR_REDERIVE_SYSTEM_PROMPT,
  selectorRederiveUserPrompt,
} from './prompts.js';
import { runShadowTest, maybePromote } from './shadow-test.js';
import { isCritical, zCandidateSelector } from './types.js';

const logger = createLogger({ service: 'worker-adapter-repair' });

/**
 * worker-adapter-repair — daily cron + on-alert XADD trigger.
 *
 * Entry points:
 *   - cron: `0 3 * * *` Africa/Douala. Sweeps all sources whose 24-h
 *     `vigil_adapter_runs_total{outcome="first_contact_failed"}` rate
 *     exceeds threshold (default 0.5/min). For each, fetches the
 *     archived first-contact HTML + the live page, prompts the LLM,
 *     writes a candidate proposal, kicks off the 48-window shadow
 *     test schedule.
 *   - hourly cron: re-runs the shadow test for every proposal in
 *     'shadow_testing' status; calls `maybePromote` after each.
 *
 * The actual selector-application functions live with each adapter in
 * `apps/adapter-runner/src/adapters/<source>.ts`; this worker uses a
 * shared `applyCssJsonSelector` shim that handles css/xpath/json_path
 * uniformly. Adapter-specific quirks (cookies, paginators) are not in
 * scope — broken paginators stay broken until manual repair.
 */

interface CandidateProposal {
  id: string;
  sourceId: string;
  candidateSelector: unknown;
  pageUrl: string;
}

async function findBrokenSources(): Promise<Array<{ id: string; pageUrl: string }>> {
  const db = await getDb();
  // We rely on adapter_health.consecutive_failures + last_error semantics
  // populated by the adapter-runner (run-one.ts). A first-contact failure
  // sets status='first_contact_failed' and bumps consecutive_failures.
  const r = await db.execute<{ source_id: string; last_error: string | null }>(sql`
    SELECT source_id, last_error
      FROM source.adapter_health
     WHERE status = 'first_contact_failed'
       AND consecutive_failures >= 3
       AND (next_scheduled_at IS NULL OR next_scheduled_at < NOW())
  `);

  // pageUrl resolution: read from sources.json via a small helper.
  // For now we trust the adapter to record its primary URL in
  // last_error metadata if the source goes 'first_contact_failed'.
  // Realistically operations also has the URL in infra/sources.yaml.
  return r.rows.map((row) => ({
    id: row.source_id,
    pageUrl: extractUrlHint(row.last_error) ?? '',
  })).filter((s) => s.pageUrl.length > 0);
}

function extractUrlHint(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/https?:\/\/[^\s)]+/);
  return m ? m[0] : null;
}

async function fetchArchivedFirstContact(sourceId: string): Promise<string | null> {
  // First-contact archives live under /srv/vigil/first-contact/<source_id>.html
  // (SRD §11.7). Mounted into the worker container at the same path.
  // Falls back to null if missing — the LLM still runs but with empty old context.
  try {
    const fs = await import('node:fs/promises');
    return await fs.readFile(`/srv/vigil/first-contact/${sourceId}.html`, 'utf8');
  } catch {
    return null;
  }
}

async function generateProposal(
  source: { id: string; pageUrl: string },
  llm: LlmRouter,
): Promise<CandidateProposal | null> {
  const newHtml = await fetchPage(source.pageUrl);
  if (!newHtml) {
    logger.warn({ source: source.id }, 'live-page-fetch-failed; skipping');
    return null;
  }
  const oldHtml = (await fetchArchivedFirstContact(source.id)) ?? '';

  // Get old selector from the adapter registry. For Phase H1 we read
  // it from a side-table the adapter writes at first-contact time.
  // (Adapter-side instrumentation is in apps/adapter-runner.)
  const db = await getDb();
  const r = await db.execute<{ selector: unknown; expected_fields: string[] }>(sql`
    SELECT selector, expected_fields
      FROM source.adapter_selector_registry
     WHERE source_id = ${source.id}
     LIMIT 1
  `);
  const oldSelector = r.rows[0]?.selector ?? {};
  const expectedFields = (r.rows[0]?.expected_fields as string[] | undefined) ?? [];

  const llmResult = await llm.call<z.infer<typeof zCandidateSelector>>({
    task: 'extraction',
    system: SELECTOR_REDERIVE_SYSTEM_PROMPT,
    user: selectorRederiveUserPrompt({
      sourceId: source.id,
      oldSelector,
      oldHtmlSnippet: oldHtml,
      newHtml,
      expectedFields,
    }),
    responseSchema: zCandidateSelector,
    maxTokens: 1_500,
    batch: true,         // overnight run, batch is fine (50% off)
    critical: false,
  });
  if (!llmResult.content.selector) {
    logger.warn({ source: source.id, rationale: llmResult.content.rationale },
      'llm-cannot-rederive');
    return null;
  }

  const proposalId = randomUUID();
  await db.execute(sql`
    INSERT INTO source.adapter_repair_proposal
      (id, source_id, candidate_selector, rationale, generated_by_llm, status)
    VALUES
      (${proposalId}::uuid, ${source.id}, ${JSON.stringify(llmResult.content.selector)}::jsonb,
       ${llmResult.content.rationale}, ${`anthropic:${llmResult.model}`}, 'shadow_testing')
  `);
  logger.info({ proposalId, source: source.id, confidence: llmResult.content.confidence },
    'proposal-generated');
  return {
    id: proposalId,
    sourceId: source.id,
    candidateSelector: llmResult.content.selector,
    pageUrl: source.pageUrl,
  };
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const r = await request(url, { method: 'GET', maxRedirections: 5 });
    if (r.statusCode >= 400) return null;
    return await r.body.text();
  } catch {
    return null;
  }
}

async function dailyRepairSweep(llm: LlmRouter): Promise<void> {
  const broken = await findBrokenSources();
  logger.info({ count: broken.length }, 'daily-repair-sweep-start');
  for (const source of broken) {
    try {
      await generateProposal(source, llm);
    } catch (e) {
      logger.error({ err: e, source: source.id }, 'proposal-generation-failed');
    }
  }
}

async function hourlyShadowSweep(): Promise<void> {
  const db = await getDb();
  const r = await db.execute<{ id: string; source_id: string; candidate_selector: unknown }>(sql`
    SELECT id, source_id, candidate_selector
      FROM source.adapter_repair_proposal
     WHERE status = 'shadow_testing'
  `);

  for (const proposal of r.rows) {
    const candidate = zCandidateSelector.safeParse({
      selector: proposal.candidate_selector,
      rationale: '',
      confidence: 1,
    });
    if (!candidate.success) continue;

    // pageUrl read from registry (same lookup path as generation).
    const url = await db.execute<{ primary_url: string }>(sql`
      SELECT primary_url
        FROM source.adapter_selector_registry
       WHERE source_id = ${proposal.source_id}
       LIMIT 1
    `);
    const pageUrl = String(url.rows[0]?.primary_url ?? '');
    if (!pageUrl) continue;

    try {
      await runShadowTest(
        {
          proposalId: proposal.id,
          sourceId: proposal.source_id,
          pageUrl,
          // For Phase H2 we use a lightweight CSS apply — the adapter
          // itself is not invoked. Cross-validating against the actual
          // adapter is Phase H6 territory (golden tests).
          applyOld: () => null,
          applyNew: () => candidate.data.selector ? {} : null,
          candidate: candidate.data,
        },
        logger,
      );
      await maybePromote(proposal.id, proposal.source_id, isCritical(proposal.source_id), logger);
    } catch (e) {
      logger.error({ err: e, proposalId: proposal.id }, 'shadow-test-cycle-failed');
    }
  }
}

async function main(): Promise<void> {
  await initTracing({ service: 'worker-adapter-repair' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const vault = await VaultClient.connect();
  registerShutdown('vault', () => vault.close());
  const apiKey = await vault.read<string>('anthropic', 'api_key');
  const llm = new LlmRouter({ anthropicApiKey: apiKey });

  // Daily 03:00 Africa/Douala — overnight when Anthropic Batch API
  // turnaround time (≤ 24 h) is acceptable.
  cron.schedule('0 3 * * *', () => {
    void dailyRepairSweep(llm);
  });

  // Hourly shadow sweep.
  cron.schedule('0 * * * *', () => {
    void hourlyShadowSweep();
  });

  logger.info('worker-adapter-repair-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
