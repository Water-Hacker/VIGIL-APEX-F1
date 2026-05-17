import { HashChain } from '@vigil/audit-chain';
import { CallRecordRepo, CertaintyRepo, FindingRepo, getDb, getPool } from '@vigil/db-postgres';
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
import { QueueClient } from '@vigil/queue';
import { VaultClient } from '@vigil/security';

// AUDIT-027 — side-effect import: registers the
// `counter-evidence.devils-advocate-narrative` prompt before any
// safe.call routes through it. Boot-only side effect; the worker
// class itself does NOT import this (kept testable per
// `apps/worker-counter-evidence/src/worker.ts` header comment).
import './prompts.js';
import { CounterWorker } from './worker.js';

const logger = createLogger({ service: 'worker-counter-evidence' });

async function main(): Promise<void> {
  const guard = new StartupGuard({ serviceName: 'worker-counter-evidence', logger });
  await guard.check();

  await initTracing({ service: 'worker-counter-evidence' });
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
      actor: 'worker-counter-evidence',
      subject_kind: event.subject_kind,
      subject_id: event.subject_id,
      payload: event.payload,
    });
  };
  await auditFeatureFlagsAtBoot({ service: 'worker-counter-evidence', emit });

  const findingRepo = new FindingRepo(db);
  const certaintyRepo = new CertaintyRepo(db);
  const callRecordRepo = new CallRecordRepo(db);

  const vault = await VaultClient.connect();
  registerShutdown('vault', () => vault.close());
  const apiKey = await vault.read<string>('anthropic', 'api_key');
  const llm = new LlmRouter({ anthropicApiKey: apiKey });

  // DECISION-011 — adversarial pipeline runs through SafeLlmRouter so every
  // call records to llm.call_record with prompt-registry hash + canary state.
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
  const modelId = process.env.VIGIL_LLM_PINNED_MODEL ?? 'claude-opus-4-7';

  const worker = new CounterWorker({
    findingRepo,
    certaintyRepo,
    callRecordRepo,
    safe,
    modelId,
    queue,
    logger,
  });
  // The raw LlmRouter (`llm`) is held only inside SafeLlmRouter as the
  // inner provider; the worker class no longer references it directly
  // (AUDIT-027). Keep the local variable so the SafeLlmRouter
  // constructor binds the same instance.
  void llm;
  await worker.start();
  registerShutdown('worker', () => worker.stop());

  await guard.markBootSuccess();
  logger.info('worker-counter-evidence-ready');
}

main().catch((e: unknown) => {
  const err = e instanceof Error ? e : new Error(String(e));
  logger.error({ err_name: err.name, err_message: err.message }, 'fatal-startup');
  process.exit(1);
});
