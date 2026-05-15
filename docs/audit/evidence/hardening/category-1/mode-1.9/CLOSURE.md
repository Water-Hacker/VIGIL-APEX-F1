# Mode 1.9 — Memory leak from forgotten references

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 3 / Category 1
**Branch:** `hardening/phase-1-orientation`

## The failure mode

Long-lived workers accumulate references that the JavaScript engine cannot garbage-collect:

- Event listeners attached via `contract.on(...)` without a matching `off(...)`.
- In-memory batch buffers that grow without periodic flush.
- Timers (`setInterval`, `setTimeout`) that never clear on shutdown.

Each is invisible while the worker is healthy. Hours-to-days later, the worker's heap grows, GC pauses lengthen, and eventually the process OOMs. Operators see the symptom (OOM, restart loop) without seeing the cause.

## What was investigated

The Phase-1 orientation flagged three candidate leak sites:

1. **`packages/queue/src/worker.ts:106-151`** — `errorWindow` bounded array. Confirmed safe: `:151` enforces `splice(0, errorWindow.length - 200)` ceiling and entries expire after 60 s.
2. **`packages/federation-stream/src/client.ts:116-118`** — `pendingBatch` + `pendingResolvers`. Re-investigated: `:279-293` `close()` clears `flushTimer`, awaits `flush()`, and closes the gRPC channel. Cleanup is symmetric.
3. **`packages/governance/src/governance-client.ts:90-158`** — `watch()` returns an unsubscribe function. **The orientation's concern was whether callers actually invoke it.** Existing tests at `__tests__/governance-client.test.ts:141-219` cover the registration / unregistration contract (5 events registered, `off()` called 5 times on unsubscribe) but don't directly test the leak-mode invariant: after `unsubscribe()`, does the handler actually stop receiving events?

## What was added

`packages/governance/__tests__/watch-leak.test.ts` — four leak-mode regression tests using a `fakeContract()` with a real per-event handler `Set` that supports `emit()` (simulating ethers' EventEmitter semantics):

1. **`handler is called BEFORE unsubscribe and NOT called AFTER`** — the actual leak-mode invariant. Fires `ProposalEscalated`; handler called. Unsubscribes; `listenerCount` drops to 0. Fires again; handler call count is UNCHANGED. If the leak existed (handler retained in a side channel), this test would catch it.

2. **`100 watch/unsubscribe cycles do not accumulate listeners`** — soak-style check. 100 paired watch+unsubscribe operations across all 5 event types. Final `listenerCount` for every event must be 0. Catches a regression where a single iteration leaks a small amount.

3. **`watch without unsubscribe leaks (proves the test would catch a leak)`** — inverse-proof test. 10 watches without unsubscribe → `listenerCount === 10`. Documents the COST of forgetting to unsubscribe (long-lived workers MUST call the returned function on shutdown).

4. **`mixed: two subscribers, unsubscribe one, the other still fires`** — proves the unsubscribe is selective. Handler A is removed; handler B still receives subsequent events. Locks in correct isolation.

## What the orientation worried about and how it's resolved now

- **"federation-stream `pendingBatch` cleanup unclear from excerpt"** — confirmed clean at `:279-293`. `close()` clears the flushTimer and flushes pending. The orientation note was a "verify" item, not an open mode; verification is now part of this closure doc.

- **"`watch()` callers might forget to unsubscribe"** — addressed by:
  - Test #3 above documents the cost.
  - The `watch()` JSDoc already says "returns an unsubscribe — caller MUST invoke this on shutdown."
  - Adoption is a per-caller concern; the primitive is correct.

- **"long-running soak test (1 h simulated) asserting steady-state memory + listener count"** — partially addressed by test #2 (100 cycles is the soak proxy). A real 1-hour test against a running cluster is out of scope for a code-only pass and would belong in the stress-test suite at `docs/audit/09-stress-test.md`.

## The invariant

Three layers:

1. **The 4 leak-regression tests** — any future change that breaks the unsubscribe contract or accumulates listeners fails CI.
2. **Existing audit-062 governance-client tests (16 cases)** — cover registration arity, idempotent unsubscribe, error isolation.
3. **The `watch()` JSDoc** — explicit contract that callers MUST invoke the returned unsubscribe.

## What this closure does NOT include

- **Adoption sweep**: every long-lived worker that calls `watch()` must call the returned unsubscribe in its shutdown hook. The primitive is correct; selective adoption per worker is incremental. Flagged for follow-up.
- **A `governance.watch()`-specific Prometheus metric for listener count.** Could be added if operators need observability; not blocking for the failure-mode closure.
- **Federation-stream stress tests.** The `close()` path is verified by inspection (manual code review of `:279-293`) but not by a multi-thousand-envelope soak test. Out of scope for the code-only pass; flagged for the stress-test suite.

## Files touched

- `packages/governance/__tests__/watch-leak.test.ts` (new, 132 lines)
- `docs/audit/evidence/hardening/category-1/mode-1.9/CLOSURE.md` (this file)

## Verification

- `pnpm --filter @vigil/governance test`: 79 passed, 1 skipped (was 75; +4 new leak tests).
- Federation-stream `close()` reviewed at `packages/federation-stream/src/client.ts:279-293` — clean.
- Queue `errorWindow` bounding reviewed at `packages/queue/src/worker.ts:106-151` — clean.
