import { createLogger, llmCostUsd, llmTokens, type Logger } from '@vigil/observability';
import { Errors } from '@vigil/shared';

import { anthropicCostUsd } from './pricing.js';

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
  /**
   * Phase D6 — monthly budget. The 80%-spend circuit is a soft gate:
   * non-critical calls (opts.critical !== true) are rejected once
   * spent ≥ monthlyUsd × monthlyCircuitFraction. Critical calls
   * (counter-evidence on escalation-eligible findings, dossier
   * narrative on a council-approved case) always pass.
   */
  readonly monthlyUsd: number;
  readonly monthlyCircuitFraction: number;
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
  // Tier-41 audit closure: monthly accumulator that survives the
  // 24h `history` trim. Pre-fix `spentThisMonth()` summed `history`
  // — but `record()` trimmed entries older than 24h, so the monthly
  // circuit could only ever see the last 24h of spend. The
  // 80%-of-$2500 = $2000 threshold was effectively dead because we
  // don't spend $2000/day; the monthly circuit never tripped.
  //
  // The accumulator is process-local: a restart resets it. That's a
  // known tradeoff — Phase D6 deferred Redis persistence. The hard
  // daily ceiling still caps a single-day blow-up; the monthly
  // accumulator catches sustained over-spend across the month.
  private monthlyCostUsd = 0;
  private monthlyResetAtUtcMs = 0;

  constructor(
    private readonly ceilings: CostCeilings = {
      dailySoftUsd: Number(process.env.LLM_DAILY_SOFT_CEILING_USD ?? 30),
      dailyHardUsd: Number(process.env.LLM_DAILY_HARD_CEILING_USD ?? 100),
      // SRD §18.4 monthly target: $2,503 — round to $2,500 for the
      // circuit. The 0.80 fraction matches the audit-plan default.
      monthlyUsd: Number(process.env.LLM_MONTHLY_BUDGET_USD ?? 2_500),
      monthlyCircuitFraction: Number(process.env.LLM_MONTHLY_CIRCUIT_FRACTION ?? 0.8),
    },
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger({ service: 'llm-cost' });
    this.monthlyResetAtUtcMs = CostTracker.currentMonthStartUtcMs();
  }

  private static currentMonthStartUtcMs(now: Date = new Date()): number {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  }

  private rollMonthlyIfNeeded(): void {
    const currentMonthStart = CostTracker.currentMonthStartUtcMs();
    if (currentMonthStart > this.monthlyResetAtUtcMs) {
      this.monthlyCostUsd = 0;
      this.monthlyResetAtUtcMs = currentMonthStart;
    }
  }

  /**
   * Total USD spent since the start of the current UTC calendar month.
   * Reads the survivable accumulator (NOT the 24h-trimmed history);
   * rolls over on the first call past a month boundary.
   */
  spentThisMonth(): number {
    this.rollMonthlyIfNeeded();
    return this.monthlyCostUsd;
  }

  /**
   * Phase D6 — monthly cost circuit. Returns true when the call should
   * be allowed; throws on hard daily ceiling. Non-critical calls are
   * rejected once monthly spend ≥ 80% of budget. Critical calls
   * (`opts.critical === true` from the router) always pass through
   * — counter-evidence and dossier narratives are spec-blocking.
   */
  shouldAllow(opts: { critical: boolean }): { allow: boolean; reason?: string } {
    this.enforceBeforeCall();
    if (opts.critical) return { allow: true };
    const monthSpent = this.spentThisMonth();
    const threshold = this.ceilings.monthlyUsd * this.ceilings.monthlyCircuitFraction;
    if (monthSpent >= threshold) {
      this.logger.warn(
        { monthSpent, threshold, monthlyBudget: this.ceilings.monthlyUsd },
        'llm-monthly-circuit-open',
      );
      return {
        allow: false,
        reason: `monthly LLM spend ${monthSpent.toFixed(2)} USD >= ${threshold.toFixed(2)} USD circuit threshold`,
      };
    }
    return { allow: true };
  }

  /**
   * Compute USD cost given an exact model_id + token counts.
   * Block-A reconciliation §2.A.4 — keyed by model_id, not modelClass.
   * Throws LlmPricingNotConfiguredError on missing entry.
   */
  computeCost(modelId: string, inputTokens: number, outputTokens: number): number {
    return anthropicCostUsd(modelId, inputTokens, outputTokens);
  }

  record(r: UsageRecord): void {
    this.history.push(r);
    // Tier-41 audit closure: bump the survivable monthly accumulator
    // BEFORE the 24h trim so the count is not lost when the history
    // entry rotates out. Honour calendar-month boundaries.
    this.rollMonthlyIfNeeded();
    this.monthlyCostUsd += r.costUsd;
    // Trim to last 24h to bound memory
    const cutoff = Date.now() - 86_400_000;
    while (this.history.length > 0 && this.history[0]!.at < cutoff) {
      this.history.shift();
    }
    llmCostUsd.labels({ provider: 'anthropic', model: r.model }).inc(r.costUsd);
    llmTokens
      .labels({ provider: 'anthropic', model: r.model, direction: 'input' })
      .inc(r.inputTokens);
    llmTokens
      .labels({ provider: 'anthropic', model: r.model, direction: 'output' })
      .inc(r.outputTokens);
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
