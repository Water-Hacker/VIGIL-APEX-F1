# Runbook — Hardening primitives: adoption guide for worker `main()`

> Step-by-step recipe for adopting the four post-pass primitives across
> the 24 worker apps. Each primitive landed in its hardening closure
> as **framework-in-place + tests** but the cross-worker adoption was
> flagged as a deferred sweep (see Cat 1/4/6 completion notes).
>
> **Audience:** the engineer adding a primitive to a worker's
> `apps/<worker-name>/src/index.ts` `main()` function.
>
> **Authority:** no architect signoff required — each adoption is a
> mechanical insertion that the closure tests already proved. The
> only judgment call per worker is: which Redis streams does this
> worker produce to? (Used by `startRedisStreamScraper`.)

---

## The four primitives

| Primitive                 | Closes mode | Package                | Touch points in `main()`                        |
| ------------------------- | ----------- | ---------------------- | ----------------------------------------------- |
| `auditFeatureFlagsAtBoot` | 6.9         | `@vigil/observability` | 1 call after `getDb()`                          |
| `startRedisStreamScraper` | 6.8         | `@vigil/queue`         | 1 call after `queue.ping()`                     |
| `StartupGuard`            | 1.7         | `@vigil/observability` | `check()` + `markBootSuccess()` inside `main()` |
| `RetryBudget`             | 1.5         | `@vigil/observability` | Per-call site at retry points                   |

The first two are cheap (1-line additions); the latter two restructure
worker startup / retry shape and warrant per-worker review.

---

## Adoption 1: `auditFeatureFlagsAtBoot` (mode 6.9)

### Goal

Every worker emits a `feature.toggled` audit-chain row at boot for
each canonical feature flag, recording the flag's current value. The
gauge `vigil_feature_flag_state{name,service}` is set in the same call.

### Pre-conditions

The worker must have:

- A Postgres connection (most do via `getDb()`).
- An audit-chain client / chain.append shim (via `@vigil/audit-log`'s
  `appendAudit` or equivalent).

### Insertion site

In `apps/<worker>/src/index.ts` `main()`, AFTER the DB connection is
established and BEFORE the worker starts consuming messages:

```ts
import {
  auditFeatureFlagsAtBoot,
  type FeatureFlagAuditEmit,
} from '@vigil/observability';
import { ChainClient } from '@vigil/audit-log';

// … inside main() …
const chain = new ChainClient(db); // or per-worker audit-chain construction

const emit: FeatureFlagAuditEmit = async (event) => {
  await chain.append({
    action: event.action,
    actor: 'worker-<NAME>', // worker identifier
    subject_kind: event.subject_kind,
    subject_id: event.subject_id,
    payload: event.payload,
  });
};

await auditFeatureFlagsAtBoot({
  service: 'worker-<NAME>',
  emit,
});
```

### Failure handling

If `chain.append` throws (audit-chain unavailable at boot), the worker
should **halt** — per doctrine §"No dark periods", a worker that
can't emit its own boot-time audit row is in an unsafe state. The
default behaviour is `await auditFeatureFlagsAtBoot(...)` propagates
the error; `main().catch(...)` exits the process.

### Verification

After deploying the adopted worker:

```bash
# Check the gauge is set for the worker's flags.
curl -s http://<worker>:9100/metrics | grep 'vigil_feature_flag_state.*service="worker-<NAME>"'

# Check the audit chain has the boot rows (one per flag).
psql -U vigil_ro -c "SELECT subject_id, payload FROM audit.event
  WHERE kind = 'feature.toggled'
    AND actor = 'worker-<NAME>'
    AND occurred_at > now() - interval '5 minutes'
  ORDER BY occurred_at DESC;"
```

---

## Adoption 2: `startRedisStreamScraper` (mode 6.8)

### Goal

The `vigil_redis_stream_length{stream}` gauge is populated every 30 s
for each stream the worker produces to. Alerts fire at 50 % / 90 %
of `MAXLEN`.

### Pre-conditions

- The worker owns a `QueueClient` (most workers do).
- The worker has an enumerable list of Redis streams it produces to.

### Insertion site

In `main()`, AFTER `queue.ping()` succeeds:

```ts
import { startRedisStreamScraper } from '@vigil/queue';

// … inside main() …
const scraper = startRedisStreamScraper(queue, {
  intervalMs: 30_000, // default; can omit
  streams: [
    'vigil:source:raw', // edit per-worker
    'vigil:finding:scored', // edit per-worker
  ],
  logger,
});
registerShutdown('redis-stream-scraper', () => scraper.stop());
```

### Per-worker stream list

Each worker has a different set. Reference:

| Worker                  | Streams it produces to                   |
| ----------------------- | ---------------------------------------- |
| worker-extractor        | `vigil:source:extracted`                 |
| worker-entity           | `vigil:entity:canonicalized`             |
| worker-pattern          | `vigil:finding:detected`                 |
| worker-score            | `vigil:finding:scored`                   |
| worker-counter-evidence | `vigil:finding:counter-evidence-fetched` |
| worker-document         | `vigil:document:fetched`                 |
| worker-dossier          | `vigil:dossier:rendered`                 |
| worker-anchor           | `vigil:dossier:anchored`                 |
| worker-audit-watch      | `vigil:audit:hash-chain-checked`         |
| worker-governance       | `vigil:proposal:emitted`                 |
| worker-tip-triage       | `vigil:tip:triaged`                      |
| worker-conac-sftp       | `vigil:dossier:delivered`                |
| worker-fabric-bridge    | `vigil:audit:fabric-mirrored`            |
| (others)                | check the worker's `XADD` call sites     |

### Failure handling

The scraper catches per-stream `xlen` errors and logs at `warn`; the
worker stays up. Default behaviour is correct.

---

## Adoption 3: `StartupGuard` (mode 1.7) — heavier

### Goal

The worker's `main().catch(…)` exit-on-fatal becomes an explicit
crash-loop circuit breaker: if the worker fails to start N times
within window W, the guard backs off exponentially and emits a
critical alert.

### Insertion site

Two insertion points inside `main()` in `apps/<worker>/src/index.ts`:

```ts
import { StartupGuard } from '@vigil/observability';

async function main(): Promise<void> {
  const guard = new StartupGuard({ serviceName: 'worker-<NAME>', logger });
  await guard.check(); // FIRST line of main()

  // ... init work: initTracing, queue.ping, DB pool, Vault, registerShutdown,
  // auditFeatureFlagsAtBoot, worker.start(), etc. ...

  await guard.markBootSuccess(); // AFTER every fail-able init step
  logger.info('worker-<NAME>-ready');
}

main().catch((e: unknown) => {
  logger.error({ err: e }, 'fatal-startup');
  process.exit(1);
});
```

`check()` reads the sentinel file under `/run/vigil/<service>.startup-failures.json`,
prunes entries older than `windowMs`, and exits with code 42 after an
exponential pre-exit sleep once `maxFailures` (default 5 in `windowMs`,
default 5 min) is exceeded. `markBootSuccess()` clears the in-progress
marker so a healthy boot does not inflate the failure window.

Defaults: `windowMs=5min`, `maxFailures=5`, `tripSleepInitialMs=30s`,
`tripSleepCapMs=5min`, `exitCode=42`. Override via constructor options.

### Per-worker scope review

`StartupGuard` changes restart semantics. Verify per-worker that:

1. The systemd / k8s service definition's restart policy works with
   the guard's backoff (default systemd `Restart=on-failure` is fine).
2. The worker's startup is genuinely idempotent — `auditFeatureFlagsAtBoot`
   emits at every boot, so 5 boot attempts in 5 min = 5 audit rows.
   That's intentional, not a bug.

### Per-worker placement guidance

`markBootSuccess()` must sit AFTER every resource that could fail at
init (DB pool, queue, Vault, audit chain, `auditFeatureFlagsAtBoot`,
`worker.start()`). Placing it earlier means an "almost-fully-booted-
then-died" failure does not bump the guard's failure counter.

For workers whose `main()` ends with an infinite `while (!stopping)`
loop, place `markBootSuccess()` immediately before the loop. For
workers whose `main()` ends with `worker.start()` + `registerShutdown`,
place `markBootSuccess()` after the registerShutdown call so a worker
that fails to attach its shutdown hook still counts as a failed boot.

---

## Adoption 4: `RetryBudget` (mode 1.5) — integrated in WorkerBase

### Goal

Cap the cluster-wide retry rate per worker so a downstream outage
can't pull the queue into a retry storm. When a handler returns
`{ kind: 'retry', ... }` and the worker's retry budget is exhausted,
the message is dead-lettered with reason
`retry-budget-exhausted: <original-reason>` instead of being
redelivered.

### Auto-adoption

`WorkerBase` (in `@vigil/queue`) now wires a `RetryBudget` instance
in its constructor automatically. Every worker that extends
`WorkerBase` inherits the gate — **no per-worker code change**.

Defaults: `maxPerWindow=120` (2 retries/sec average per worker),
`windowSeconds=60`. The budget name is the worker name; pressure
shows up as `vigil_retry_budget_exhausted_total{name=<worker>}`.

### Override / opt-out

Pass `retryBudget` in `WorkerBaseConfig`:

```ts
new MyWorker({
  name: 'worker-foo',
  stream: STREAMS.FOO,
  schema: ...,
  client: queue,
  retryBudget: {
    // Bump the ceiling for a worker that handles legitimate bursts.
    maxPerWindow: 300,
    windowSeconds: 60,
  },
});
```

To opt out entirely (e.g., for integration tests that drive a
synthetic burst):

```ts
new MyWorker({ ..., retryBudget: { enabled: false } });
```

### Per-call-site budgets (optional, advanced)

Beyond the central WorkerBase budget, a worker can construct
additional per-dependency budgets (one for Polygon, one for the LLM
provider, etc.) and gate specific call sites:

```ts
import { RetryBudget } from '@vigil/observability';

const polygonBudget = new RetryBudget(queue.redis, {
  name: `${workerName}:polygon`,
  maxPerWindow: 30,
});

// At a Polygon-call retry site:
const reserve = await polygonBudget.tryReserve();
if (!reserve.allowed) {
  // skip the retry; fail-fast or wait the window
  return { kind: 'dead-letter', reason: 'polygon-budget-exhausted' };
}
```

This is **optional**, not required for adoption — the central
WorkerBase budget covers the common case.

### Verification

```bash
# Cluster-wide retry rate per worker (current window):
curl -s http://prometheus:9090/api/v1/query?query=vigil_retry_budget_exhausted_total

# A worker hitting the ceiling triggers the
# `handler-retry-budget-exhausted-deadletter` log at error level
# AND increments the counter above.
```

---

## Adoption tracker

The current state (post-Phase-12a) is **zero workers have adopted any
of the four primitives**. Each worker's adoption can be tracked in a
follow-up PR with:

```
chore(worker-<NAME>): adopt hardening primitives (modes 6.8, 6.9 [, 1.5, 1.7])
```

Suggested per-PR scope:

- **Cheap PR (10-20 min each)**: `auditFeatureFlagsAtBoot` +
  `startRedisStreamScraper` only. Apply across all 24 workers in
  one PR series.
- **Medium PR (per worker)**: `StartupGuard`. Apply per-worker with
  systemd restart-policy verification.
- **Heavy PR (per worker)**: `RetryBudget`. Per-call-site retries.

---

## Verification across the fleet

After all adoptions land:

```bash
# Every worker emits one feature-flag audit row per defined flag.
psql -U vigil_ro -c "SELECT actor, count(*) FROM audit.event
  WHERE kind = 'feature.toggled'
    AND occurred_at > now() - interval '24 hours'
  GROUP BY actor ORDER BY actor;"

# Every worker that produces to streams has scraper-coverage.
curl -s http://prometheus:9090/api/v1/query?query=count(vigil_redis_stream_length)by(stream)
```

---

## Related

- `packages/observability/src/feature-flags.ts` — `auditFeatureFlagsAtBoot`
- `packages/queue/src/client.ts` — `startRedisStreamScraper`
- `packages/observability/src/startup-guard.ts` — `StartupGuard`
- `packages/observability/src/retry-budget.ts` — `RetryBudget`
- `docs/audit/evidence/hardening/category-6/mode-6.8/CLOSURE.md` — flagged the deferral
- `docs/audit/evidence/hardening/category-6/mode-6.9/CLOSURE.md` — flagged the deferral
- `docs/audit/evidence/hardening/category-1/mode-1.5/CLOSURE.md` — RetryBudget primitive
- `docs/audit/evidence/hardening/category-1/mode-1.7/CLOSURE.md` — StartupGuard primitive
