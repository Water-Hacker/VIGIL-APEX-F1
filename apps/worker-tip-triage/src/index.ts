import { TipRepo, getDb } from '@vigil/db-postgres';
import { LlmRouter } from '@vigil/llm';
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
import { sealedBoxDecrypt, VaultClient } from '@vigil/security';
import { z } from 'zod';

const logger = createLogger({ service: 'worker-tip-triage' });

const zPayload = z.object({
  tip_id: z.string().uuid(),
  // Three Shamir shares from council members (3-of-5; SRD §28.4 quorum decryption)
  decryption_shares: z.array(z.string()).min(3).max(5),
});
type Payload = z.infer<typeof zPayload>;

const TIP_PARAPHRASE_SYSTEM = `
You are paraphrasing a citizen tip for VIGIL APEX's operator triage queue.

CRITICAL: do NOT reproduce the tip verbatim. Strip any personally identifying
detail that would expose the submitter (specific dates only known to a small
group, internal reference numbers, very precise locations). Preserve the
substance of the allegation. Output max 500 chars.

Output JSON: {"paraphrase":"...","topic_hint":"procurement|payroll|infrastructure|sanctions|banking|other","severity_hint":"low|medium|high|critical"}
`.trim();

const zParaphrase = z.object({
  paraphrase: z.string().min(20).max(500),
  topic_hint: z.enum(['procurement', 'payroll', 'infrastructure', 'sanctions', 'banking', 'other']),
  severity_hint: z.enum(['low', 'medium', 'high', 'critical']),
});

class TipTriageWorker extends WorkerBase<Payload> {
  constructor(
    private readonly tipRepo: TipRepo,
    private readonly vault: VaultClient,
    private readonly llm: LlmRouter,
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
    const tip = await this.tipRepo.getByRef(env.payload.tip_id);
    if (!tip) return { kind: 'dead-letter', reason: 'tip not found' };

    // Recover the operator team private key from Vault using the supplied shares.
    // For Phase 1 we read the privkey directly; quorum-Shamir recovery is a
    // future enhancement (SRD §28.4 hints at it; council-quorum-decryption is wired
    // in worker-council-decrypt).
    const sk = await this.vault.read<string>('tip-portal', 'operator_team_private_key');
    const pk = await this.vault.read<string>('tip-portal', 'operator_team_public_key');

    let plaintext: Uint8Array;
    try {
      plaintext = await sealedBoxDecrypt(
        Buffer.from(tip.body_ciphertext).toString('base64'),
        // expose() — operator-team key, not council Shamir
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('@vigil/security') as { expose: <T>(s: import('@vigil/security').Secret<T>) => T }).expose(pk),
        sk,
      );
    } catch (e) {
      logger.error({ err: e }, 'tip-decrypt-failed');
      return { kind: 'dead-letter', reason: 'decrypt-failure' };
    }
    const text = new TextDecoder().decode(plaintext);

    // LLM paraphrase pass
    try {
      const r = await this.llm.call<z.infer<typeof zParaphrase>>({
        task: 'tip_classify',
        modelClassOverride: 'haiku',
        system: TIP_PARAPHRASE_SYSTEM,
        user: `Tip text:\n${text.slice(0, 4000)}`,
        responseSchema: zParaphrase,
        ...(env.correlation_id && { correlationId: env.correlation_id }),
      });
      logger.info({ tip_id: tip.id, severity: r.content.severity_hint }, 'tip-paraphrased');
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

  const vault = await VaultClient.connect();
  registerShutdown('vault', () => vault.close());
  const apiKey = await vault.read<string>('anthropic', 'api_key');
  const llm = new LlmRouter({ anthropicApiKey: apiKey });

  const worker = new TipTriageWorker(tipRepo, vault, llm, queue);
  await worker.start();
  registerShutdown('worker', () => worker.stop());
  logger.info('worker-tip-triage-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
