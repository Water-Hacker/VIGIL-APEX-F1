import { createLogger, llmCostUsd, llmTokens, type Logger } from '@vigil/observability';
import { Constants, Errors } from '@vigil/shared';

/**
 * Cost tracker — enforces daily soft / hard ceilings (SRD §18.4).
 *
 * - Soft ceiling: warning logged + dashboard alert; calls continue.
 * - Hard ceiling: throw `LlmCostCeilingError`; lower-priority calls throttle.
 *
 * Costs are computed from input/output token counts using model-specific
 * pricing constants. We always use the LIST price (no Batch / cache discount
 * assumed) so the ceiling triggers earlier than the actual bill.
 */

export interface CostCeilings {
  readonly dailySoftUsd: number;
  readonly dailyHardUsd: number;
}

export interface UsageRecord {
  readonly model: string;
  readonly modelClass: 'opus' | 'sonnet' | 'haiku';
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly at: number; // epoch ms
}

export class CostTracker {
  private readonly history: UsageRecord[] = [];
  private readonly logger: Logger;

  constructor(
    private readonly ceilings: CostCeilings = {
      dailySoftUsd: Number(process.env.LLM_DAILY_SOFT_CEILING_USD ?? 30),
      dailyHardUsd: Number(process.env.LLM_DAILY_HARD_CEILING_USD ?? 100),
    },
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger({ service: 'llm-cost' });
  }

  /** Compute USD cost given a model class + token counts. */
  computeCost(modelClass: 'opus' | 'sonnet' | 'haiku', inputTokens: number, outputTokens: number): number {
    const p = Constants.ANTHROPIC_PRICING_USD_PER_MTOK[modelClass];
    return (inputTokens * p.input) / 1_000_000 + (outputTokens * p.output) / 1_000_000;
  }

  record(r: UsageRecord): void {
    this.history.push(r);
    // Trim to last 24h to bound memory
    const cutoff = Date.now() - 86_400_000;
    while (this.history.length > 0 && this.history[0]!.at < cutoff) {
      this.history.shift();
    }
    llmCostUsd.labels({ provider: 'anthropic', model: r.model }).inc(r.costUsd);
    llmTokens.labels({ provider: 'anthropic', model: r.model, direction: 'input' }).inc(r.inputTokens);
    llmTokens.labels({ provider: 'anthropic', model: r.model, direction: 'output' }).inc(r.outputTokens);
  }

  /** Total USD spent in the last 24h. */
  spentLast24h(): number {
    return this.history.reduce((acc, r) => acc + r.costUsd, 0);
  }

  /** Throws LlmCostCeilingError if hard ceiling exceeded. Logs warning at soft. */
  enforceBeforeCall(): void {
    const spent = this.spentLast24h();
    if (spent >= this.ceilings.dailyHardUsd) {
      throw new Errors.LlmCostCeilingError(spent, this.ceilings.dailyHardUsd);
    }
    if (spent >= this.ceilings.dailySoftUsd) {
      this.logger.warn(
        { spent, soft: this.ceilings.dailySoftUsd, hard: this.ceilings.dailyHardUsd },
        'llm-cost-soft-ceiling',
      );
    }
  }
}
