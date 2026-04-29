import { FindingRepo, getDb } from '@vigil/db-postgres';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';
import { bayesianPosterior, type BayesianSignal } from '@vigil/patterns';
import {
  QueueClient,
  STREAMS,
  WorkerBase,
  newEnvelope,
  type Envelope,
  type HandlerOutcome,
} from '@vigil/queue';
import { Constants, Routing } from '@vigil/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

const logger = createLogger({ service: 'worker-score' });

const zPayload = z.object({ finding_id: z.string().uuid() });
type Payload = z.infer<typeof zPayload>;

class ScoreWorker extends WorkerBase<Payload> {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly db: any,
    private readonly findingRepo: FindingRepo,
    queue: QueueClient,
  ) {
    super({
      name: 'worker-score',
      stream: STREAMS.SCORE_COMPUTE,
      schema: zPayload,
      client: queue,
      logger,
      concurrency: 4,
    });
  }

  protected async handle(env: Envelope<Payload>): Promise<HandlerOutcome> {
    const { finding_id } = env.payload;
    // Pull all signals on this finding
    const r = await this.db.execute(sql`
      SELECT pattern_id, prior, strength, weight
        FROM finding.signal
       WHERE finding_id = ${finding_id}
    `);
    const signals: BayesianSignal[] = r.rows.map((row: { pattern_id: string | null; prior: number; strength: number; weight: number }) => ({
      pattern_id: row.pattern_id,
      prior: Number(row.prior),
      strength: Number(row.strength),
      weight: Number(row.weight),
    }));
    if (signals.length === 0) return { kind: 'ack' };

    const posterior = bayesianPosterior(signals, {
      correlationDamping: 0.5,
      // Known correlated pairs — empirically reduce double-counting
      correlatedPairs: [
        ['P-B-001', 'P-F-002'], // shell + director-ring frequently co-occur
        ['P-A-001', 'P-H-001'], // single-bidder + temporal anomaly often related
      ],
    });

    await this.findingRepo.setPosterior(finding_id, posterior);
    logger.info({ finding_id, posterior, signals: signals.length }, 'posterior-computed');

    // Counter-evidence pass when above threshold
    if (posterior >= Constants.POSTERIOR_COUNTER_EVIDENCE_THRESHOLD) {
      await this.config.client.publish(
        STREAMS.COUNTER_EVIDENCE,
        newEnvelope(
          'worker-score',
          { finding_id },
          `${finding_id}|counter`,
          env.correlation_id,
        ),
      );
    }
    if (posterior >= Constants.POSTERIOR_REVIEW_THRESHOLD) {
      await this.findingRepo.setState(finding_id, 'review');

      // DECISION-010 — populate the auto-recommended recipient body so the
      // operator UI has a default to display before the council vote opens.
      // Pick the strongest signal's pattern_id as the primary; routing
      // helper maps category → body.
      const strongest = signals
        .filter((s) => s.pattern_id !== null)
        .sort((a, b) => b.strength * b.weight - a.strength * a.weight)[0];
      const primaryPatternId = strongest?.pattern_id ?? null;
      const parsed = primaryPatternId !== null ? Routing.parsePatternId(primaryPatternId) : null;
      const finding = await this.findingRepo.getById(finding_id);
      const severity = (finding?.severity ?? 'low') as 'low' | 'medium' | 'high' | 'critical';
      const recommended = Routing.recommendRecipientBody({
        patternCategory: parsed?.category ?? 'A',
        severity,
      });
      await this.findingRepo.setRecommendedRecipientBody(
        finding_id,
        recommended,
        primaryPatternId,
      );
      logger.info(
        { finding_id, recommended, primaryPatternId },
        'recommended-recipient-body-set',
      );
    }
    return { kind: 'ack' };
  }
}

async function main(): Promise<void> {
  await initTracing({ service: 'worker-score' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());
  const db = await getDb();
  const findingRepo = new FindingRepo(db);

  const worker = new ScoreWorker(db, findingRepo, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());
  logger.info('worker-score-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
