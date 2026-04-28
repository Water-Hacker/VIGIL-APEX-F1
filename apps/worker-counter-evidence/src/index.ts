import { FindingRepo, getDb } from '@vigil/db-postgres';
import { LlmRouter, type LlmCallOptions } from '@vigil/llm';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';
import {
  QueueClient,
  STREAMS,
  WorkerBase,
  type Envelope,
  type HandlerOutcome,
} from '@vigil/queue';
import { VaultClient } from '@vigil/security';
import { z } from 'zod';

const logger = createLogger({ service: 'worker-counter-evidence' });

const zPayload = z.object({ finding_id: z.string().uuid() });
type Payload = z.infer<typeof zPayload>;

const COUNTER_SYSTEM_PROMPT = `
You are a senior auditor performing a devil's-advocate review on a finding produced
by VIGIL APEX, an automated procurement-fraud detection system.

Your job: identify reasons the finding might be wrong, missing context, or have a
benign alternative explanation. Examples: emergency procurement justified by an
official decree; an exclusion clause that explains a single-bidder award; a
satellite cloud-cover false negative; a name collision in entity resolution.

Output:
{
  "concerns": ["<concern 1>", "<concern 2>", ...],
  "alternative_explanation": "<one paragraph or null>",
  "verification_steps": ["<step 1>", "<step 2>", ...]
}

If you cannot find any reason the finding might be wrong, output:
{"concerns":[],"alternative_explanation":null,"verification_steps":["Independently re-verify each numerical citation."]}

Always cite source documents via {document_cid, page, char_span} when referring to
evidence. Refuse to invent context that isn't in the supplied finding.
`.trim();

const zCounterResp = z.object({
  concerns: z.array(z.string()).max(20),
  alternative_explanation: z.string().nullable(),
  verification_steps: z.array(z.string()).max(20),
});

class CounterWorker extends WorkerBase<Payload> {
  constructor(
    private readonly findingRepo: FindingRepo,
    private readonly llm: LlmRouter,
    queue: QueueClient,
  ) {
    super({
      name: 'worker-counter-evidence',
      stream: STREAMS.COUNTER_EVIDENCE,
      schema: zPayload,
      client: queue,
      logger,
      concurrency: 2,
    });
  }

  protected async handle(env: Envelope<Payload>): Promise<HandlerOutcome> {
    const finding = await this.findingRepo.getById(env.payload.finding_id);
    if (!finding) return { kind: 'dead-letter', reason: 'finding not found' };

    const opts: LlmCallOptions = {
      task: 'devils_advocate',
      modelClassOverride: 'opus',
      system: COUNTER_SYSTEM_PROMPT,
      user: JSON.stringify(
        {
          finding_id: finding.id,
          title_en: finding.title_en,
          summary_en: finding.summary_en,
          severity: finding.severity,
          posterior: finding.posterior,
          amount_xaf: finding.amount_xaf,
        },
        null,
        2,
      ),
      maxTokens: 1500,
      responseSchema: zCounterResp,
      ...(env.correlation_id && { correlationId: env.correlation_id }),
    };

    try {
      const r = await this.llm.call<z.infer<typeof zCounterResp>>(opts);
      const text =
        `Concerns:\n- ${r.content.concerns.join('\n- ') || 'none identified'}\n\n` +
        (r.content.alternative_explanation
          ? `Alternative explanation:\n${r.content.alternative_explanation}\n\n`
          : '') +
        `Verification steps:\n- ${r.content.verification_steps.join('\n- ')}`;
      // Single repo call — atomic state + counter_evidence write, no inline
      // require() hop. Replaces the previous two-step UPDATE that briefly
      // left findings in 'review' state without their devil's-advocate text.
      await this.findingRepo.setCounterEvidence(finding.id, text, 'review');
      return { kind: 'ack' };
    } catch (e) {
      logger.error({ err: e }, 'counter-evidence-failed');
      return { kind: 'retry', reason: 'llm-failure', delay_ms: 30_000 };
    }
  }
}

async function main(): Promise<void> {
  await initTracing({ service: 'worker-counter-evidence' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());
  const db = await getDb();
  const findingRepo = new FindingRepo(db);

  const vault = await VaultClient.connect();
  registerShutdown('vault', () => vault.close());
  const apiKey = await vault.read<string>('anthropic', 'api_key');
  const llm = new LlmRouter({ anthropicApiKey: apiKey });

  const worker = new CounterWorker(findingRepo, llm, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());
  logger.info('worker-counter-evidence-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
