import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import { LlmRouter } from './router.js';
import {
  canaryFor,
  canaryTriggered,
  globalPromptRegistry,
  renderClosedContext,
  validateVerbatimGrounding,
  type ClosedContextSource,
  type CitedExtraction,
  type SourceRecordIndex,
} from './safety/index.js';

import type { Logger } from '@vigil/observability';

/**
 * AI-SAFETY-DOCTRINE-v1 — the single chokepoint every Claude call goes
 * through when the result will inform a finding. Wraps the existing
 * `LlmRouter` with:
 *
 *   - closed-context rendering (delimited <source_document> markers)
 *   - daily-rotated canary (failure mode 4)
 *   - forced citation schema + verbatim grounding (failure modes 1, 5)
 *   - prompt versioning + model pinning (failure modes 12, 14)
 *   - low temperature default (failure mode 1)
 *   - call-record persistence for the AI-Safety dashboard (failure modes 1,
 *     3, 4, 12)
 *
 * The persistence side is delegated to a `CallRecordSink` so the package
 * stays decoupled from db-postgres. `worker-score` plugs in a sink backed
 * by `CallRecordRepo`.
 */

export interface CallRecordSink {
  record(input: {
    id: string;
    finding_id: string | null;
    assessment_id: string | null;
    prompt_name: string;
    prompt_version: string;
    prompt_template_hash: string;
    model_id: string;
    temperature: number;
    input_hash: string;
    output_hash: string;
    canary_triggered: boolean;
    schema_valid: boolean;
    latency_ms: number;
    cost_usd: number;
    called_at: string;
  }): Promise<void>;
}

export interface SafeCallInput<TResult> {
  readonly findingId: string | null;
  readonly assessmentId: string | null;
  readonly promptName: string;
  readonly task: string;
  readonly sources: ReadonlyArray<ClosedContextSource>;
  readonly responseSchema: z.ZodType<TResult, z.ZodTypeDef, unknown>;
  readonly modelId: string;
  readonly temperature?: number;
  readonly sourceIndex?: SourceRecordIndex;
  readonly extraInstructions?: string;
}

export interface SafeCallOutcome<TResult> {
  readonly value: TResult;
  readonly canaryTriggered: boolean;
  readonly schemaValid: boolean;
  /** When the response is a CitedExtraction, the rejection list — claims
   *  whose verbatim_quote did not appear in the cited source field. */
  readonly verbatimRejections: ReadonlyArray<{ claim: unknown; reason: string }>;
}

const DEFAULT_TEMPERATURE = 0.1;

export class SafeLlmRouter {
  constructor(
    private readonly inner: LlmRouter,
    private readonly logger: Logger,
    private readonly sink: CallRecordSink | null = null,
  ) {}

  async call<TResult>(input: SafeCallInput<TResult>): Promise<SafeCallOutcome<TResult>> {
    const promptEntry = globalPromptRegistry.latest(input.promptName);
    if (!promptEntry) {
      throw new Error(`prompt '${input.promptName}' not registered`);
    }
    const today = new Date();
    const canary = canaryFor({ date: today });
    const closed = renderClosedContext({
      task: input.task,
      sources: input.sources,
      ...(input.extraInstructions !== undefined && { extraInstructions: input.extraInstructions }),
      date: today,
    });

    const temperature = input.temperature ?? DEFAULT_TEMPERATURE;
    const inputHash = createHash('sha256')
      .update(`${closed.systemPreamble}|${closed.userMessage}|${input.modelId}|${temperature}`)
      .digest('hex');

    const start = Date.now();
    const result = await this.inner.call({
      task: 'extraction',
      system: closed.systemPreamble,
      user: closed.userMessage,
      temperatureOverride: temperature,
      responseSchema: input.responseSchema,
    });
    const latency = Date.now() - start;

    const outputText =
      typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    const outputHash = createHash('sha256').update(outputText).digest('hex');
    const triggered = canaryTriggered(outputText, today);
    void canary; // retain reference for explicit closure

    // Tier-10 LLM-pipeline audit closure: persist the call-record
    // BEFORE attempting schema validation. Pre-fix, a schema failure
    // threw early and the sink.record was never reached, so:
    //   (a) the AI-Safety dashboard saw 0 schema-failures (silent
    //       under-reporting of every malformed response);
    //   (b) the call had no audit trail at all.
    // Per AI-SAFETY-DOCTRINE-v1, EVERY LLM call must be recorded —
    // schema failures are exactly the kind of event operators need
    // to see.
    //
    // We pre-parse with safeParse to compute schemaValid, persist the
    // record, then throw on failure / proceed on success. Verbatim
    // grounding still runs after on success, but the record reflects
    // the schema outcome accurately.
    const parsed = input.responseSchema.safeParse(result.content);
    const schemaValid = parsed.success;

    let verbatimRejections: ReadonlyArray<{ claim: unknown; reason: string }> = [];
    let value: TResult | undefined;
    if (parsed.success) {
      value = parsed.data;
      // Verbatim-grounding pass when the response is a CitedExtraction.
      if (input.sourceIndex && isCitedExtraction(value as unknown)) {
        const outcome = validateVerbatimGrounding(
          value as unknown as CitedExtraction,
          input.sourceIndex,
        );
        verbatimRejections = outcome.rejected;
        // Replace the response's claims with the grounded subset — the
        // engine never sees ungrounded claims.
        (value as unknown as CitedExtraction).claims = [...outcome.grounded];
      }
    }

    if (this.sink) {
      try {
        await this.sink.record({
          id: randomUUID(),
          finding_id: input.findingId,
          assessment_id: input.assessmentId,
          prompt_name: input.promptName,
          prompt_version: promptEntry.version,
          prompt_template_hash: promptEntry.hash,
          model_id: input.modelId,
          temperature,
          input_hash: inputHash,
          output_hash: outputHash,
          canary_triggered: triggered,
          schema_valid: schemaValid,
          latency_ms: latency,
          cost_usd: 0,
          called_at: new Date().toISOString(),
        });
      } catch (err) {
        this.logger.warn({ err }, 'safe-router-sink-write-failed');
      }
    }

    if (!parsed.success) {
      // Tier-10 audit closure: surface the actual Zod issues in the
      // log so operators can diagnose. Pre-fix the catch swallowed
      // the error info, leaving operators with only a "schema failed"
      // string and no path to root-cause.
      this.logger.error(
        {
          prompt_name: input.promptName,
          model_id: input.modelId,
          output_hash: outputHash,
          zod_issues: parsed.error.issues.slice(0, 8),
        },
        'safe-router-schema-validation-failed',
      );
      throw new Error(`safe-router: response failed schema validation for ${input.promptName}`);
    }

    if (triggered) {
      throw new Error(
        `safe-router: canary phrase appeared in output for ${input.promptName} — ` +
          'system prompt may have been compromised by injected instructions',
      );
    }

    return {
      value: value as TResult,
      canaryTriggered: triggered,
      schemaValid,
      verbatimRejections,
    };
  }
}

function isCitedExtraction(value: unknown): value is CitedExtraction {
  return (
    typeof value === 'object' &&
    value !== null &&
    'claims' in (value as Record<string, unknown>) &&
    Array.isArray((value as Record<string, unknown>).claims)
  );
}
