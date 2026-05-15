# Mode 6.4 — Silent rate-limit response from upstream service

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 7 / Category 6
**Branch:** `hardening/phase-1-orientation`

## The failure mode

`packages/llm/src/providers/anthropic.ts` caught all exceptions in a generic `catch (e)` block and logged them identically: a 429-exhaustion (we're being rate-limited) looked the same as a model outage, a network error, or an auth error. Operators couldn't distinguish "the platform is being throttled by the provider" from "the model is down" — different remediation actions, same metric signal.

## What was added

### 1. `vigil_llm_rate_limit_exhausted_total{provider,model}` counter

`packages/observability/src/metrics.ts` — new typed counter with `provider` + `model` labels. Operators see per-model throttling pressure: opus might be rate-limited while haiku is fine, or vice versa.

### 2. Typed `RateLimitError` detection in the Anthropic provider

`packages/llm/src/providers/anthropic.ts:148-163` — the catch block now uses `instanceof RateLimitError` (typed import from `@anthropic-ai/sdk`):

```typescript
} catch (e) {
  this.circuit.recordFailure();
  if (e instanceof RateLimitError) {
    llmRateLimitExhaustedTotal.inc({ provider: this.name, model });
    this.logger.warn(..., 'anthropic-rate-limit-exhausted; SDK retries (default 3) were not enough');
  } else {
    this.logger.error(..., 'anthropic-call-failed');
  }
  throw e;
}
```

Rate-limit exhaustion logs at warn (it's a back-pressure signal, not an error); other failures keep error level.

### 3. Prometheus alert `LlmRateLimitExhausted`

`infra/docker/prometheus/alerts/vigil.yml` — fires when `rate(vigil_llm_rate_limit_exhausted_total[5m]) > 0.083` (>5 events in 5 min) for 5 min. Severity warning (the SDK is retrying; sustained exhaustion needs operator attention but isn't catastrophic).

### 4. Three unit tests

`packages/llm/__tests__/rate-limit-detection.test.ts`:

1. **Counter increments on `RateLimitError`** — mocks the Anthropic SDK to throw a `RateLimitError`, calls the provider, asserts the counter for the correct model is exactly 1 and the error propagates unchanged.
2. **Counter does NOT increment on other errors** — mocks a generic `Error('connection refused')`, asserts the counter stays at 0 and the original error propagates.
3. **Counter labels split by model** — fires 2 opus-rate-limits + 1 sonnet-rate-limit; asserts the per-model counts match.

## The invariant

Three layers:

1. **Typed `RateLimitError` detection** — uses the SDK's exported error class, not message parsing. Future SDK upgrades that change the message format won't break detection.
2. **The 3 unit tests** lock the contract: rate-limit → counter+1; other error → counter unchanged; per-model labels stay correct.
3. **The `LlmRateLimitExhausted` Prometheus alert** surfaces sustained pressure independent of any single failure path.

## What this closure does NOT include

- **Bedrock provider rate-limit detection**. The AWS SDK exposes a different error shape (`ThrottlingException`); the Bedrock provider would need its own typed branch. Out of scope for this commit; flagged for follow-up when the architect adopts Bedrock for production fallback.
- **LocalLlm provider rate-limit detection**. Local providers don't typically rate-limit. N/A.
- **Adaptive token bucket that pre-empts the SDK retry** — would let workers know "we're approaching the rate limit" before exhaustion. Requires coordination with mode 1.5's `RetryBudget` to be useful; flagged for follow-up.

## Files touched

- `packages/observability/src/metrics.ts` (+17 lines: new counter)
- `packages/llm/src/providers/anthropic.ts` (RateLimitError import + typed detection in catch block)
- `infra/docker/prometheus/alerts/vigil.yml` (+13 lines: `LlmRateLimitExhausted` alert)
- `packages/llm/__tests__/rate-limit-detection.test.ts` (new, 130 lines)
- `docs/audit/evidence/hardening/category-6/mode-6.4/CLOSURE.md` (this file)

## Verification

- `pnpm --filter @vigil/observability run typecheck`: clean.
- `pnpm --filter @vigil/llm run typecheck`: clean.
- `pnpm --filter @vigil/llm test`: 54 passed (was 51; +3 mode 6.4 tests).
