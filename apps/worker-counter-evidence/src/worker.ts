import { randomUUID } from 'node:crypto';

import { createClaudeLlmEvaluator, runAdversarial } from '@vigil/certainty-engine';
import {
  type Envelope,
  type HandlerOutcome,
  type QueueClient,
  STREAMS,
  WorkerBase,
} from '@vigil/queue';
import { z } from 'zod';

import type { CallRecordRepo, CertaintyRepo, FindingRepo } from '@vigil/db-postgres';
import type { Logger } from '@vigil/observability';
import type { Schemas } from '@vigil/shared';

// AUDIT-027: the `counter-evidence.devils-advocate-narrative` prompt
// MUST be registered with the global SafeLlmRouter registry before
// any `safe.call({ promptName: 'counter-evidence...' })` is issued.
// The side-effect import lives in `index.ts` (the boot module), not
// here — this file is reachable from tests, and `./prompts.js`
// chains through `@vigil/llm` → `@anthropic-ai/bedrock-sdk`'s broken
// `./core` exports map (worker-tip-triage hit + documented the same
// issue). Production safety is preserved: SafeLlmRouter throws
// `prompt '...' not registered` at call time if `index.ts` failed
// to perform the side-effect import.

/**
 * Structural router interface — mirrors `SafeRouterShape` in
 * certainty-engine and `SafeLlmRouterLike` in worker-extractor /
 * worker-tip-triage. Pinning the structural type here keeps the
 * worker's test surface free of the broken `@anthropic-ai/bedrock-sdk`
 * `./core` exports map (vitest's resolver fails on it), without
 * weakening any production guarantee — `@vigil/llm`'s real
 * `SafeLlmRouter` satisfies this interface structurally.
 */
export interface SafeLlmRouterLike {
  call<TResult>(input: {
    findingId: string | null;
    assessmentId: string | null;
    promptName: string;
    task: string;
    sources: ReadonlyArray<{ id: string; label?: string; text: string }>;
    responseSchema: z.ZodType<TResult, z.ZodTypeDef, unknown>;
    modelId: string;
    temperature?: number;
  }): Promise<{ value: TResult }>;
}

export const zPayload = z.object({
  finding_id: z.string().uuid(),
  /** Optional — set when worker-score routes to action_queue. Tells this
   *  worker to run the AI-Safety doctrine adversarial pipeline against
   *  the assessment before any analyst sees the finding. */
  assessment_id: z.string().uuid().optional(),
});
export type Payload = z.infer<typeof zPayload>;

const zCounterResp = z.object({
  concerns: z.array(z.string()).max(20),
  alternative_explanation: z.string().nullable(),
  verification_steps: z.array(z.string()).max(20),
});

export interface CounterWorkerDeps {
  readonly findingRepo: FindingRepo;
  readonly certaintyRepo: CertaintyRepo;
  readonly callRecordRepo: CallRecordRepo;
  readonly safe: SafeLlmRouterLike;
  readonly modelId: string;
  readonly queue: QueueClient;
  readonly logger: Logger;
}

export class CounterWorker extends WorkerBase<Payload> {
  private readonly findingRepo: FindingRepo;
  private readonly certaintyRepo: CertaintyRepo;
  private readonly callRecordRepo: CallRecordRepo;
  private readonly safe: SafeLlmRouterLike;
  private readonly modelId: string;
  private readonly workerLogger: Logger;

  constructor(deps: CounterWorkerDeps) {
    super({
      name: 'worker-counter-evidence',
      stream: STREAMS.COUNTER_EVIDENCE,
      schema: zPayload,
      client: deps.queue,
      logger: deps.logger,
      concurrency: 2,
    });
    this.findingRepo = deps.findingRepo;
    this.certaintyRepo = deps.certaintyRepo;
    this.callRecordRepo = deps.callRecordRepo;
    this.safe = deps.safe;
    this.modelId = deps.modelId;
    this.workerLogger = deps.logger;
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
          const holdReasons: Schemas.HoldReason[] = [
            ...(assessment.hold_reasons as Schemas.HoldReason[]),
          ];
          if (
            !adversarial.order_randomisation_stable &&
            !holdReasons.includes('order_randomisation_disagreement')
          ) {
            holdReasons.push('order_randomisation_disagreement');
          }
          if (
            adversarial.devils_advocate_coherent &&
            !holdReasons.includes('devils_advocate_coherent')
          ) {
            holdReasons.push('devils_advocate_coherent');
          }
          if (
            !adversarial.counterfactual_robust &&
            !holdReasons.includes('counterfactual_collapse')
          ) {
            holdReasons.push('counterfactual_collapse');
          }
          if (
            !adversarial.secondary_review_agreement &&
            !holdReasons.includes('secondary_review_disagreement')
          ) {
            holdReasons.push('secondary_review_disagreement');
          }
          // The dispatch tier may downgrade if any defence rejected.
          const downgraded =
            adversarial.devils_advocate_coherent ||
            !adversarial.counterfactual_robust ||
            !adversarial.order_randomisation_stable ||
            !adversarial.secondary_review_agreement;
          const newTier: 'action_queue' | 'investigation_queue' | 'log_only' = downgraded
            ? Number(assessment.posterior_probability) >= 0.8
              ? 'investigation_queue'
              : 'log_only'
            : (assessment.tier as 'action_queue' | 'investigation_queue' | 'log_only');
          await this.certaintyRepo.upsertAssessment({
            id: randomUUID(),
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
          this.workerLogger.info(
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
          // Tier-36 audit closure: pre-fix this branch logged and kept
          // going — the assessment row from worker-score still carried
          // DEFAULT_ADVERSARIAL (everything-passed) so the council saw
          // the finding at action_queue tier as if all checks had
          // PASSED. Silent adversarial-pipeline failure → false-
          // positive escalation. Fix: if the pipeline fails to run at
          // all, force a downgrade with the synthetic hold reason
          // `adversarial_pipeline_failed` so the council sees the
          // finding only as investigation_queue (or log_only if the
          // posterior didn't clear 0.8).
          const e = err instanceof Error ? err : new Error(String(err));
          this.workerLogger.error(
            { err_name: e.name, err_message: e.message, finding_id: finding.id },
            'adversarial-pipeline-failed',
          );
          try {
            const posterior = Number(assessment.posterior_probability);
            const downgradedTier: 'investigation_queue' | 'log_only' =
              posterior >= 0.8 ? 'investigation_queue' : 'log_only';
            const holdReasons: Schemas.HoldReason[] = [
              ...(assessment.hold_reasons as Schemas.HoldReason[]),
              'adversarial_pipeline_failed' as Schemas.HoldReason,
            ];
            await this.certaintyRepo.upsertAssessment({
              id: randomUUID(),
              finding_id: assessment.finding_id,
              engine_version: assessment.engine_version,
              prior_probability: assessment.prior_probability,
              posterior_probability: assessment.posterior_probability,
              independent_source_count: assessment.independent_source_count,
              tier: downgradedTier,
              hold_reasons: holdReasons,
              adversarial: assessment.adversarial,
              components: assessment.components,
              severity: assessment.severity,
              input_hash: assessment.input_hash,
              prompt_registry_hash: assessment.prompt_registry_hash,
              model_version: assessment.model_version,
              computed_at: new Date(),
            });
            await this.findingRepo.setState(finding.id, 'review');
            this.workerLogger.warn(
              { finding_id: finding.id, downgraded_tier: downgradedTier },
              'adversarial-pipeline-failed-downgraded-tier',
            );
          } catch (writeErr) {
            const we = writeErr instanceof Error ? writeErr : new Error(String(writeErr));
            this.workerLogger.error(
              { err_name: we.name, err_message: we.message, finding_id: finding.id },
              'adversarial-downgrade-write-failed',
            );
            // Re-throw so the worker dead-letters this envelope rather
            // than ack a finding whose tier may now be inconsistent.
            throw writeErr;
          }
        }
      } else if (env.payload.assessment_id) {
        // Tier-36 audit closure: the linked assessment is missing or
        // has been superseded by a newer write. Pre-fix this case fell
        // through silently. Log so operators investigating "why didn't
        // the adversarial pipeline run for X?" can see the cause.
        this.workerLogger.warn(
          {
            finding_id: finding.id,
            expected_assessment_id: env.payload.assessment_id,
            actual_assessment_id: assessment?.id ?? null,
          },
          'counter-evidence-assessment-mismatch; adversarial pipeline skipped',
        );
      }
    }

    // 2) Devil's-advocate NARRATIVE for the operator UI.
    //    AUDIT-027: routes through SafeLlmRouter using the registered
    //    'counter-evidence.devils-advocate-narrative' prompt. The
    //    response schema is non-cited (free-form paragraph by design),
    //    so the L1/L8/L10/L12 citation-grounded layers don't apply,
    //    but L4 (canary in output), L5 (schema validation), L9
    //    (language consistency), and L11 (daily-rotated canary) do.
    const findingSummaryJson = JSON.stringify(
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
    );

    try {
      const outcome = await this.safe.call({
        findingId: finding.id,
        assessmentId: env.payload.assessment_id ?? null,
        promptName: 'counter-evidence.devils-advocate-narrative',
        task: 'devils_advocate_narrative',
        sources: [
          {
            id: `finding:${finding.id}`,
            label: 'finding-summary',
            text: findingSummaryJson,
          },
        ],
        responseSchema: zCounterResp,
        modelId: this.modelId,
      });
      const r = outcome.value;
      const text =
        `Concerns:\n- ${r.concerns.join('\n- ') || 'none identified'}\n\n` +
        (r.alternative_explanation
          ? `Alternative explanation:\n${r.alternative_explanation}\n\n`
          : '') +
        `Verification steps:\n- ${r.verification_steps.join('\n- ')}`;
      await this.findingRepo.setCounterEvidence(finding.id, text, 'review');
      void this.callRecordRepo;
      return { kind: 'ack' };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.workerLogger.error(
        { err_name: err.name, err_message: err.message, finding_id: finding.id },
        'counter-evidence-failed',
      );
      return { kind: 'retry', reason: 'llm-failure', delay_ms: 30_000 };
    }
  }
}
