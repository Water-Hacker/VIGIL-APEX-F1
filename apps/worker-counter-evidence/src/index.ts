import {
  createClaudeLlmEvaluator,
  runAdversarial,
} from '@vigil/certainty-engine';
import { CallRecordRepo, CertaintyRepo, FindingRepo, getDb } from '@vigil/db-postgres';
import {
  LlmRouter,
  SafeLlmRouter,
  Safety,
  type LlmCallOptions,
} from '@vigil/llm';
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

import type { Schemas } from '@vigil/shared';

const logger = createLogger({ service: 'worker-counter-evidence' });

const zPayload = z.object({
  finding_id: z.string().uuid(),
  /** Optional — set when worker-score routes to action_queue. Tells this
   *  worker to run the AI-Safety doctrine adversarial pipeline against
   *  the assessment before any analyst sees the finding. */
  assessment_id: z.string().uuid().optional(),
});
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
    private readonly certaintyRepo: CertaintyRepo,
    private readonly callRecordRepo: CallRecordRepo,
    private readonly llm: LlmRouter,
    private readonly safe: SafeLlmRouter,
    private readonly modelId: string,
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

    // 1) Doctrine adversarial pipeline (only when an assessment is linked).
    if (env.payload.assessment_id) {
      const assessment = await this.certaintyRepo.latestForFinding(finding.id);
      if (assessment && assessment.id === env.payload.assessment_id) {
        try {
          const components = (assessment.components as Schemas.CertaintyComponent[]) ?? [];
          const evaluator = createClaudeLlmEvaluator(this.safe, {
            findingId: finding.id,
            assessmentId: assessment.id,
            modelId: this.modelId,
          });
          const adversarial = await runAdversarial({
            findingId: finding.id,
            prior: Number(assessment.prior_probability),
            components,
            evaluator,
          });
          // Persist a fresh assessment row carrying the real adversarial
          // outcome. Hold-reasons on the new row reflect the full pipeline.
          const holdReasons: Schemas.HoldReason[] = [...(assessment.hold_reasons as Schemas.HoldReason[])];
          if (!adversarial.order_randomisation_stable && !holdReasons.includes('order_randomisation_disagreement')) {
            holdReasons.push('order_randomisation_disagreement');
          }
          if (adversarial.devils_advocate_coherent && !holdReasons.includes('devils_advocate_coherent')) {
            holdReasons.push('devils_advocate_coherent');
          }
          if (!adversarial.counterfactual_robust && !holdReasons.includes('counterfactual_collapse')) {
            holdReasons.push('counterfactual_collapse');
          }
          if (!adversarial.secondary_review_agreement && !holdReasons.includes('secondary_review_disagreement')) {
            holdReasons.push('secondary_review_disagreement');
          }
          // The dispatch tier may downgrade if any defence rejected.
          const downgraded =
            adversarial.devils_advocate_coherent ||
            !adversarial.counterfactual_robust ||
            !adversarial.order_randomisation_stable ||
            !adversarial.secondary_review_agreement;
          const newTier: 'action_queue' | 'investigation_queue' | 'log_only' =
            downgraded
              ? Number(assessment.posterior_probability) >= 0.8
                ? 'investigation_queue'
                : 'log_only'
              : (assessment.tier as 'action_queue' | 'investigation_queue' | 'log_only');
          await this.certaintyRepo.upsertAssessment({
            id: crypto.randomUUID(),
            finding_id: assessment.finding_id,
            engine_version: assessment.engine_version,
            prior_probability: assessment.prior_probability,
            posterior_probability: assessment.posterior_probability,
            independent_source_count: assessment.independent_source_count,
            tier: newTier,
            hold_reasons: holdReasons,
            adversarial,
            components: assessment.components,
            severity: assessment.severity,
            input_hash: assessment.input_hash,
            prompt_registry_hash: assessment.prompt_registry_hash,
            model_version: assessment.model_version,
            computed_at: new Date(),
          });
          logger.info(
            {
              finding_id: finding.id,
              assessment_id: assessment.id,
              new_tier: newTier,
              hold_reasons: holdReasons,
              order_min: adversarial.order_randomisation_min,
              order_max: adversarial.order_randomisation_max,
              devils_coherent: adversarial.devils_advocate_coherent,
              cf_robust: adversarial.counterfactual_robust,
              secondary_agreement: adversarial.secondary_review_agreement,
            },
            'adversarial-pipeline-completed',
          );
          if (newTier === 'log_only' || newTier === 'investigation_queue') {
            await this.findingRepo.setState(finding.id, 'review');
          }
        } catch (err) {
          logger.error({ err, finding_id: finding.id }, 'adversarial-pipeline-failed');
          // Adversarial failure ≠ counter-evidence failure; keep going so
          // the operator at least sees the narrative.
        }
      }
    }

    // 2) Devil's-advocate NARRATIVE for the operator UI (legacy; uses the
    //    older non-cited prompt — kept so analysts still get a free-form
    //    review summary on every finding).
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
      await this.findingRepo.setCounterEvidence(finding.id, text, 'review');
      void this.callRecordRepo;
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

  const worker = new CounterWorker(
    findingRepo,
    certaintyRepo,
    callRecordRepo,
    llm,
    safe,
    modelId,
    queue,
  );
  await worker.start();
  registerShutdown('worker', () => worker.stop());
  logger.info('worker-counter-evidence-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
