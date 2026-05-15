import { setTimeout as sleep } from 'node:timers/promises';

import { HashChain } from '@vigil/audit-chain';
import { getDb, getPool } from '@vigil/db-postgres';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  registerShutdown,
  shutdownTracing,
  startMetricsServer,
} from '@vigil/observability';

const logger = createLogger({ service: 'worker-outcome-feedback' });

/**
 * worker-outcome-feedback — Layer-7 closure of FRONTIER-AUDIT.
 *
 * Periodic (default: hourly) loop that:
 *
 *   1. Polls the public RSS / SFTP feeds the platform is configured to
 *      ingest as operational signals:
 *      - CONAC press releases
 *      - Cour Suprême judgments  (public court roll)
 *      - ARMP debarment listings
 *      - TPI court rolls
 *      - ANIF bulletins
 *      - MINFI clawback bulletins
 *
 *   2. For each new signal, fetches all delivered dossiers in the
 *      relevant temporal window and runs `matchSignalAgainstDossiers`.
 *
 *   3. Persists high-confidence matches (score >= 0.7 AND entity
 *      overlap >= 0.30) as `dossier_outcome` rows. Below-confidence
 *      matches are surfaced to operators via the dashboard for
 *      human curation.
 *
 *   4. Re-computes per-recipient-body backlog estimates from the
 *      matched outcomes and persists them to `recipient_body_backlog`
 *      where `routeWithCaseLoadAwareness` reads them at decision time.
 *
 *   5. Emits an `audit.outcome_feedback_cycle` chain row.
 *
 * The feed-poll side is intentionally not implemented here — each feed
 * is a separate adapter (CONAC may use RSS, Cour Suprême may use a
 * scraped HTML page, ARMP may use a CSV download). Adapters live in
 * `apps/adapter-runner/src/adapters/` and emit signals onto a Redis
 * stream; this worker consumes that stream.
 *
 * Phase-1 status: scaffolded with full matching logic (pure +
 * exhaustively tested) and a periodic-loop shell. The HTTP feed
 * adapters (CONAC press / Cour Suprême roll / ARMP debarment) are
 * documented in `docs/audit/outcome-feedback-adapters.md` and pending
 * the architect's MOU work + counsel review of feed-ingest legality
 * for the Cour Suprême roll specifically.
 */
async function main(): Promise<void> {
  await initTracing({ service: 'worker-outcome-feedback' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const intervalMs = Number(process.env.OUTCOME_FEEDBACK_INTERVAL_MS ?? 60 * 60_000); // 1h default

  // Touch DB handles to surface init errors at boot rather than at first tick.
  await getDb();
  const pool = await getPool();
  const chain = new HashChain(pool, logger);

  let stopping = false;
  registerShutdown('outcome-loop', () => {
    stopping = true;
  });

  logger.info({ intervalMs }, 'worker-outcome-feedback-ready');

  while (!stopping) {
    try {
      // Tick body — placeholder until the adapter-runner side is online.
      // When operational, this calls:
      //   const signals = await poolDrainOutcomeSignals(queue);
      //   const dossiers = await listRecentDeliveredDossiers(pool, 36 * 30);
      //   for each signal:
      //     const matches = matchSignalAgainstDossiers(signal, dossiers);
      //     for each high-confidence match:
      //       await insertDossierOutcome(pool, match);
      //   const backlogProfiles = await recomputeRecipientBacklogs(pool);
      //   await upsertRecipientBacklogs(pool, backlogProfiles);
      await chain.append({
        action: 'audit.outcome_feedback_cycle',
        actor: 'system:worker-outcome-feedback',
        subject_kind: 'system',
        subject_id: 'outcome-feedback',
        payload: {
          interval_ms: intervalMs,
          signals_processed: 0,
          high_confidence_matches: 0,
          backlogs_updated: 0,
          note: 'adapter-runner feed ingestion pending architect MOU + counsel review',
        },
      });
      logger.info({}, 'outcome-feedback-tick');
    } catch (err) {
      logger.error({ err }, 'outcome-feedback-loop-error');
    }
    await sleep(intervalMs);
  }
  logger.info('worker-outcome-feedback-stopping');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'fatal-startup');
  process.exit(1);
});
