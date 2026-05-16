import { HashChain } from '@vigil/audit-chain';
import { CallRecordRepo, TipRepo, getDb, getPool } from '@vigil/db-postgres';
import { LlmRouter, SafeLlmRouter, Safety } from '@vigil/llm';
import {
  StartupGuard,
  auditFeatureFlagsAtBoot,
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
  type FeatureFlagAuditEmit,
} from '@vigil/observability';
import { QueueClient, STREAMS, WorkerBase, type Envelope, type HandlerOutcome } from '@vigil/queue';
import { VaultClient } from '@vigil/security';

import { handleTip, zTipTriagePayload, type TipTriagePayload } from './triage-flow.js';

const logger = createLogger({ service: 'worker-tip-triage' });

// Block-B A2 migration: TIP_PARAPHRASE_SYSTEM moved into the
// SafeLlmRouter prompt registry under name 'tip-triage.paraphrase'
// in src/prompts.ts. The PII-stripping rules now live in
// `TIP_PARAPHRASE_TASK` and are passed via safe.call's `task` field
// (closed-context <task> element). The doctrine system preamble
// from AI-SAFETY-DOCTRINE-v1 wraps every call so L4 prompt-injection
// + L11 daily-canary apply uniformly.
//
// Block-E E.2: handler logic extracted to src/triage-flow.ts so the
// 3-of-5 council Shamir decrypt → SafeLlmRouter paraphrase flow is
// E2E-testable without spinning up Vault / Postgres / Redis. See
// __tests__/tor-flow-e2e.test.ts.

class TipTriageWorker extends WorkerBase<TipTriagePayload> {
  constructor(
    private readonly tipRepo: TipRepo,
    private readonly vault: VaultClient,
    private readonly safe: SafeLlmRouter,
    private readonly modelId: string,
    queue: QueueClient,
  ) {
    super({
      name: 'worker-tip-triage',
      stream: STREAMS.TIP_TRIAGE,
      schema: zTipTriagePayload,
      client: queue,
      logger,
      concurrency: 1, // sensitive — process serially
    });
  }

  protected async handle(env: Envelope<TipTriagePayload>): Promise<HandlerOutcome> {
    return handleTip(
      {
        tipRepo: this.tipRepo,
        vault: this.vault,
        safe: this.safe,
        modelId: this.modelId,
        logger,
      },
      env,
    );
  }
}

async function main(): Promise<void> {
  const guard = new StartupGuard({ serviceName: 'worker-tip-triage', logger });
  await guard.check();

  await initTracing({ service: 'worker-tip-triage' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());
  const db = await getDb();
  const pool = await getPool();
  const chain = new HashChain(pool, logger);
  const emit: FeatureFlagAuditEmit = async (event) => {
    await chain.append({
      action: event.action,
      actor: 'worker-tip-triage',
      subject_kind: event.subject_kind,
      subject_id: event.subject_id,
      payload: event.payload,
    });
  };
  await auditFeatureFlagsAtBoot({ service: 'worker-tip-triage', emit });

  const tipRepo = new TipRepo(db);
  const callRecordRepo = new CallRecordRepo(db);

  const vault = await VaultClient.connect();
  registerShutdown('vault', () => vault.close());
  const apiKey = await vault.read<string>('anthropic', 'api_key');
  const llm = new LlmRouter({ anthropicApiKey: apiKey });

  // DECISION-011 / Block-B A2 — adversarial pipeline runs through
  // SafeLlmRouter so every call records to llm.call_record with the
  // prompt-registry hash + canary state.
  if (!Safety.adversarialPromptsRegistered()) {
    throw new Error('AI-Safety canonical prompts missing from globalPromptRegistry');
  }
  const safe = new SafeLlmRouter(llm, logger, {
    record: async (input) => {
      await callRecordRepo.record({
        ...input,
        temperature: input.temperature.toString(),
        cost_usd: input.cost_usd.toString(),
        called_at: new Date(input.called_at),
      });
    },
  });
  const modelId = process.env.TIP_TRIAGE_MODEL ?? 'claude-haiku-4-5-20251001';

  const worker = new TipTriageWorker(tipRepo, vault, safe, modelId, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());

  await guard.markBootSuccess();
  logger.info({ modelId }, 'worker-tip-triage-ready');
}

main().catch((e: unknown) => {
  const err = e instanceof Error ? e : new Error(String(e));
  logger.error({ err_name: err.name, err_message: err.message }, 'fatal-startup');
  process.exit(1);
});
