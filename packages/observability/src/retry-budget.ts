import { retryBudgetTotalReserved, retryBudgetExhaustedTotal } from './metrics.js';

/**
 * Structural Redis interface — accepts any ioredis-compatible client
 * without taking a dependency on the ioredis package. The two methods
 * we need are `eval` (for the atomic INCR+EXPIRE Lua) and `get` (for
 * the read-only currentUsage helper).
 */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

/**
 * Hardening mode 1.5 — Cascading failure under retry storm.
 *
 * The failure mode: a shared dependency fails (Polygon RPC, Postgres
 * replica, Vault). Each of the ~12 worker fleets independently retries
 * on its own configured cadence (mode 1.6 adaptive backoff caps the
 * per-worker rate but does not coordinate across workers). When the
 * dependency comes back up, the recovered service is hit by 12
 * uncoordinated retry streams simultaneously, which can re-overload
 * it and cause a secondary outage.
 *
 * `RetryBudget` is a Redis-backed sliding-window counter that every
 * worker checks before retrying. The budget is "N retries per minute,
 * across all workers". When the budget is exhausted, `tryReserve()`
 * returns `{ allowed: false }` and the caller skips its retry. The
 * Prometheus counter `vigil_retry_budget_exhausted_total` makes the
 * pressure visible to operators.
 *
 * Two metrics are emitted:
 *   - `vigil_retry_budget_reserved_total{name}` — every reservation
 *     (allowed or not), so operators can see the retry rate.
 *   - `vigil_retry_budget_exhausted_total{name}` — only when the
 *     ceiling was crossed.
 *
 * Use one budget per logical dependency family, e.g. one for Polygon,
 * one for the LLM provider, one for cross-witness verification.
 */

const RESERVE_LUA = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
  end
  return current
`;

export interface RetryBudgetOptions {
  /** Budget namespace (e.g. 'polygon', 'llm', 'fabric'). */
  readonly name: string;
  /** Hard ceiling per window. Requests above this are denied. */
  readonly maxPerWindow: number;
  /** Window length in seconds. Default 60. */
  readonly windowSeconds?: number;
  /** Now() injection for tests. Default Date.now. */
  readonly nowMs?: () => number;
}

export interface ReserveResult {
  readonly allowed: boolean;
  /** The post-INCR counter value. May exceed `ceiling` when denied. */
  readonly current: number;
  readonly ceiling: number;
}

export class RetryBudget {
  private readonly name: string;
  private readonly maxPerWindow: number;
  private readonly windowSeconds: number;
  private readonly nowMs: () => number;

  constructor(
    private readonly redis: RedisLike,
    opts: RetryBudgetOptions,
  ) {
    if (opts.maxPerWindow <= 0) {
      throw new Error('RetryBudget: maxPerWindow must be positive');
    }
    this.name = opts.name;
    this.maxPerWindow = opts.maxPerWindow;
    this.windowSeconds = opts.windowSeconds ?? 60;
    this.nowMs = opts.nowMs ?? (() => Date.now());
  }

  /**
   * Attempt to reserve one retry slot. Returns `{ allowed: false }`
   * if the global ceiling is exceeded in the current window.
   *
   * The caller should respect the result: if `!allowed`, skip the
   * retry and either fail-fast or wait for the next window. Calling
   * `tryReserve()` again immediately just burns more budget if the
   * caller proceeds with the retry anyway.
   */
  async tryReserve(): Promise<ReserveResult> {
    const window = Math.floor(this.nowMs() / 1_000 / this.windowSeconds);
    const key = `vigil:retry-budget:${this.name}:${window}`;
    const current = Number(await this.redis.eval(RESERVE_LUA, 1, key, String(this.windowSeconds)));
    retryBudgetTotalReserved.inc({ name: this.name });
    const allowed = current <= this.maxPerWindow;
    if (!allowed) {
      retryBudgetExhaustedTotal.inc({ name: this.name });
    }
    return { allowed, current, ceiling: this.maxPerWindow };
  }

  /**
   * Read-only current budget usage in the active window. Does NOT
   * consume budget. Useful for dashboards / health endpoints.
   */
  async currentUsage(): Promise<{ current: number; ceiling: number }> {
    const window = Math.floor(this.nowMs() / 1_000 / this.windowSeconds);
    const key = `vigil:retry-budget:${this.name}:${window}`;
    const raw = await this.redis.get(key);
    return { current: raw ? Number(raw) : 0, ceiling: this.maxPerWindow };
  }
}
