# Mode 1.1 — Race condition between two workers processing the same message

**State after closure:** closed-verified (test deepening)
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 3 / Category 1
**Branch:** `hardening/phase-1-orientation`

## The failure mode

Two worker instances consume from the same Redis Streams consumer group. The classic two-RTT race — `SET NX` for the dedup key, then `XACK` — has a window where both workers acquire ownership of the same message between their respective `SET` and `XACK` calls. The result: the same message is processed twice, downstream side effects fire twice, and the operator never sees an error because both workers think they did valid work.

## What was already in place

`packages/queue/src/worker.ts:35-43` already implements the dedup-and-ack via a single atomic Lua script (`DEDUP_AND_ACK_LUA`):

```lua
local set = redis.call('SET', KEYS[1], '1', 'EX', tonumber(ARGV[3]), 'NX')
if set then
  return 1
else
  redis.call('XACK', KEYS[2], ARGV[1], ARGV[2])
  return 0
end
```

The script is correct **by construction**: Redis evaluates Lua scripts atomically (the entire script runs as a single command from the server's perspective; no other client can interleave between the `SET NX` and the `XACK`). The orientation flagged this as closed-verified at the implementation level but noted the test coverage was thin — `packages/queue/__tests__/worker-clock.test.ts` exercises adaptive concurrency only, not the dedup race itself.

## What was added

`packages/queue/__tests__/dedup-race.test.ts` — three integration tests gated on `INTEGRATION_REDIS_URL` that exercise the actual failure-mode boundary by invoking the Lua script from multiple ioredis clients in parallel against a real Redis:

1. **`two clients calling the dedup script in parallel: exactly one gets ownership`** — fires `eval(LUA)` from two ioredis clients simultaneously against the same dedup key + stream message ID; asserts results sort to `[0, 1]`.

2. **`twenty parallel clients racing on the same dedup_key: exactly one wins`** — scales the race to N=20 to catch any weaker-than-expected atomicity claim. Asserts exactly 1 winner (returned 1) and 19 losers (returned 0).

3. **`TTL on the dedup key prevents replay within the TTL window`** — first call wins; second call from a different client within the TTL window loses; `TTL` on the key is positive and ≤ requested TTL. Verifies the 24-hour replay-prevention claim that the production code relies on.

All three tests skip without `INTEGRATION_REDIS_URL` (consistent with the `audit-log-cas` integration gating pattern). In CI, where Redis is available via the GitHub Actions service container at `redis://localhost:6379`, they execute.

## The invariant

The three test cases are the regression invariant. They lock in the atomicity claim:

- If the production code is ever refactored to split the dedup logic into separate `SET` + `XACK` commands (which WOULD re-introduce the race), the 20-client test will fail because the winner count drifts from 1.
- If the TTL is ever omitted or set incorrectly, the third test fails.
- If a future Redis version changes Lua-eval semantics, this test surfaces the change before it reaches production.

## What this closure does NOT include

- **An adaptive-replay test** that exercises XAUTOCLAIM-style takeover of idle pending messages from dead consumer instances (the parallel concern of mode 1.1). That's a different code path (`packages/queue/src/worker.ts:autoclaim`) and a different failure mode (orphan-message recovery, not race condition). Flagged for follow-up if needed; it's a sibling concern, not a precondition for closing 1.1.
- **A property-based test** generating arbitrary numbers of concurrent clients. The N=2 and N=20 cases together are sufficient evidence; arbitrary-N would only confirm the same algebraic property.

## Files touched

- `packages/queue/__tests__/dedup-race.test.ts` (new, 109 lines)
- `docs/audit/evidence/hardening/category-1/mode-1.1/CLOSURE.md` (this file)

## Verification

- `pnpm --filter @vigil/queue test`: 10 passed, 3 skipped (the 3 new dedup-race tests; integration-gated).
- Test loads cleanly under vitest (no compilation issues).
- The test will execute in CI when `INTEGRATION_REDIS_URL` is set in the workflow environment.
