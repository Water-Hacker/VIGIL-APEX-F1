import { HashChain } from '@vigil/audit-chain';
import {
  DossierOutcomeRepo,
  getDb,
  getPool,
  listRecentDeliveredDossiersForMatching,
} from '@vigil/db-postgres';
import {
  StartupGuard,
  auditFeatureFlagsAtBoot,
  createLogger,
  installShutdownHandler,
  initTracing,
  registerShutdown,
  shutdownTracing,
  startMetricsServer,
  type FeatureFlagAuditEmit,
} from '@vigil/observability';
import { QueueClient, STREAMS, WorkerBase, type Envelope, type HandlerOutcome } from '@vigil/queue';

import {
  handleOutcomeSignal,
  zOutcomeSignalPayload,
  type OutcomeSignalPayload,
} from './handler.js';

const logger = createLogger({ service: 'worker-outcome-feedback' });

/**
 * worker-outcome-feedback — FRONTIER-AUDIT Layer-7 closure.
 *
 * Consumes operational-signal envelopes from STREAMS.OUTCOME_SIGNAL.
 * Adapter-runner feeds (CONAC press, Cour Suprême roll, ARMP debarment,
 * TPI court roll, ANIF bulletin, MINFI clawback) publish here after
 * they parse the source into the canonical OperationalSignal shape.
 *
 * Per envelope:
 *   1. List dossiers delivered within the attribution window (default
 *      540 days; max 1080 = 36 months per matchOutcome contract).
 *   2. Run `matchSignalAgainstDossiers` — token-Jaccard entity overlap,
 *      temporal proximity, source→body alignment, category alignment.
 *   3. For every high-confidence match (entity ≥ 0.30 AND temporal > 0
 *      AND score ≥ 0.7), insert one row into `dossier.dossier_outcome`
 *      (idempotent on signal_id + dossier_id).
 *   4. Emit one `audit.dossier_outcome_matched` chain row per inserted
 *      outcome.
 *
 * Low-confidence matches are NOT auto-persisted — they are surfaced to
 * operators via the dashboard's outcome curation queue. This worker is
 * deterministic and deliberately conservative.
 */

class OutcomeFeedbackWorker extends WorkerBase<OutcomeSignalPayload> {
  constructor(
    private readonly chain: HashChain,
    private readonly outcomeRepo: DossierOutcomeRepo,
    private readonly listDelivered: (
      windowDays: number,
    ) => Promise<Awaited<ReturnType<typeof listRecentDeliveredDossiersForMatching>>>,
    queue: QueueClient,
  ) {
    super({
      name: 'worker-outcome-feedback',
      stream: STREAMS.OUTCOME_SIGNAL,
      schema: zOutcomeSignalPayload,
      client: queue,
      logger,
      concurrency: 4,
    });
  }

  protected async handle(env: Envelope<OutcomeSignalPayload>): Promise<HandlerOutcome> {
    return handleOutcomeSignal(
      {
        chain: this.chain,
        outcomeRepo: this.outcomeRepo,
        listDelivered: this.listDelivered,
        logger,
      },
      env,
    );
  }
}

async function main(): Promise<void> {
  const guard = new StartupGuard({ serviceName: 'worker-outcome-feedback', logger });
  await guard.check();

  await initTracing({ service: 'worker-outcome-feedback' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const db = await getDb();
  const pool = await getPool();
  const outcomeRepo = new DossierOutcomeRepo(db);
  const chain = new HashChain(pool, logger);
  const listDelivered = (windowDays: number) =>
    listRecentDeliveredDossiersForMatching(db, windowDays);

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());

  const emit: FeatureFlagAuditEmit = async (event) => {
    await chain.append({
      action: event.action,
      actor: 'worker-outcome-feedback',
      subject_kind: event.subject_kind,
      subject_id: event.subject_id,
      payload: event.payload,
    });
  };
  await auditFeatureFlagsAtBoot({ service: 'worker-outcome-feedback', emit });

  const worker = new OutcomeFeedbackWorker(chain, outcomeRepo, listDelivered, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());

  await guard.markBootSuccess();
  logger.info({ stream: STREAMS.OUTCOME_SIGNAL }, 'worker-outcome-feedback-ready');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'fatal-startup');
  process.exit(1);
});
