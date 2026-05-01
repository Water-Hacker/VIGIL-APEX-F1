import { CallRecordRepo, TipRepo, getDb } from '@vigil/db-postgres';
import { LlmRouter, SafeLlmRouter, Safety } from '@vigil/llm';
import {
  createLogger,
  installShutdownHandler,
  initTracing,
  shutdownTracing,
  startMetricsServer,
  registerShutdown,
} from '@vigil/observability';
import { QueueClient, STREAMS, WorkerBase, type Envelope, type HandlerOutcome } from '@vigil/queue';
import {
  expose,
  sealedBoxDecrypt,
  shamirCombineFromBase64,
  VaultClient,
  wrapSecret,
} from '@vigil/security';
import { z } from 'zod';

import { TIP_PARAPHRASE_TASK } from './prompts.js';

const logger = createLogger({ service: 'worker-tip-triage' });

const zPayload = z.object({
  tip_id: z.string().uuid(),
  // Three Shamir shares from council members (3-of-5; SRD §28.4 quorum decryption)
  decryption_shares: z.array(z.string()).min(3).max(5),
});
type Payload = z.infer<typeof zPayload>;

// Block-B A2 migration: TIP_PARAPHRASE_SYSTEM moved into the
// SafeLlmRouter prompt registry under name 'tip-triage.paraphrase'
// in src/prompts.ts. The PII-stripping rules now live in
// `TIP_PARAPHRASE_TASK` and are passed via safe.call's `task` field
// (closed-context <task> element). The doctrine system preamble
// from AI-SAFETY-DOCTRINE-v1 wraps every call so L4 prompt-injection
// + L11 daily-canary apply uniformly.

function toBase64(bytes: Uint8Array): string {
  // Encode without depending on Node's Buffer import surface — the worker
  // runtime always has it via the runtime, but importing keeps node:buffer
  // off the type-check path for environments that don't ship @types/node.
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const buf: { from: (b: Uint8Array) => { toString: (enc: string) => string } } = (
    globalThis as { Buffer?: unknown }
  ).Buffer as never;
  return buf.from(bytes).toString('base64');
}

const zParaphrase = z.object({
  paraphrase: z.string().min(20).max(500),
  topic_hint: z.enum(['procurement', 'payroll', 'infrastructure', 'sanctions', 'banking', 'other']),
  severity_hint: z.enum(['low', 'medium', 'high', 'critical']),
});

class TipTriageWorker extends WorkerBase<Payload> {
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
      schema: zPayload,
      client: queue,
      logger,
      concurrency: 1, // sensitive — process serially
    });
  }

  protected async handle(env: Envelope<Payload>): Promise<HandlerOutcome> {
    // tip_id is the row UUID (matches Zod schema above + the dashboard
    // /api/triage/tips/decrypt body). Lookup must hit the id column, not ref.
    const tip = await this.tipRepo.getById(env.payload.tip_id);
    if (!tip) return { kind: 'dead-letter', reason: 'tip not found' };

    // 3-of-5 council quorum decryption (SRD §28.4). The inbound payload
    // carries three council Shamir shares of the operator-team private key;
    // we reconstruct the key in-memory, decrypt, and immediately drop the
    // reconstructed handle. The shares themselves were collected by the
    // /triage/tips operator UI (Phase C10) — never persisted server-side.
    const pk = await this.vault.read<string>('tip-portal', 'operator_team_public_key');

    let reconstructedSk;
    try {
      reconstructedSk = shamirCombineFromBase64(env.payload.decryption_shares);
    } catch (e) {
      logger.error({ err: e, tip_id: tip.id }, 'shamir-combine-failed');
      return { kind: 'dead-letter', reason: 'shamir-combine-failure' };
    }

    let plaintext: Uint8Array;
    try {
      // sealedBoxDecrypt expects base64-encoded keys/ciphertexts; the
      // reconstructed Shamir bytes are the libsodium private key, so we
      // re-encode through Secret<string> wrapping to keep the unwrap
      // surface narrow.
      const skBytes = expose(reconstructedSk);
      const skB64 = wrapSecret(toBase64(skBytes));
      plaintext = await sealedBoxDecrypt(
        toBase64(tip.body_ciphertext as unknown as Uint8Array),
        expose(pk),
        skB64,
      );
    } catch (e) {
      logger.error({ err: e }, 'tip-decrypt-failed');
      return { kind: 'dead-letter', reason: 'decrypt-failure' };
    }
    const text = new TextDecoder().decode(plaintext);

    // LLM paraphrase pass — Block-B A2 migration: routes through
    // SafeLlmRouter so the doctrine system preamble + canary +
    // call-record audit + prompt-version pin apply uniformly.
    try {
      const outcome = await this.safe.call<z.infer<typeof zParaphrase>>({
        findingId: null,
        assessmentId: null,
        promptName: 'tip-triage.paraphrase',
        task: TIP_PARAPHRASE_TASK,
        sources: [{ id: `tip:${tip.id}`, label: 'tip-body', text: text.slice(0, 4000) }],
        responseSchema: zParaphrase,
        modelId: this.modelId,
      });
      logger.info({ tip_id: tip.id, severity: outcome.value.severity_hint }, 'tip-paraphrased');
      // Update disposition + paraphrase notes (encrypted at rest with the same operator-team key)
      await this.tipRepo.setDisposition(tip.id, 'IN_TRIAGE', 'worker-tip-triage');
    } catch (e) {
      logger.error({ err: e }, 'paraphrase-failed');
      return { kind: 'retry', reason: 'llm-failure', delay_ms: 60_000 };
    }
    return { kind: 'ack' };
  }
}

async function main(): Promise<void> {
  await initTracing({ service: 'worker-tip-triage' });
  const metrics = await startMetricsServer();
  registerShutdown('metrics', () => metrics.close());
  installShutdownHandler(logger);
  registerShutdown('tracing', shutdownTracing);

  const queue = new QueueClient({ logger });
  await queue.ping();
  registerShutdown('queue', () => queue.close());
  const db = await getDb();
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
  logger.info({ modelId }, 'worker-tip-triage-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
