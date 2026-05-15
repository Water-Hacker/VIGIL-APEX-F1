# Mode 6.8 — Silent quota exhaustion

**State after closure:** closed-verified
**Closed at:** 2026-05-15
**Pass:** code-hardening 90-mode pass, Phase 7 / Category 6
**Branch:** `hardening/phase-1-orientation`

## The failure mode

VIGIL APEX has several quotas that, if exceeded, cause data loss or service degradation:

- **Redis stream length** — capped by `MAXLEN=1M` per stream. At the cap, Redis drops the OLDEST entries. The drop is silent (no error to producers, no signal to consumers).
- **DB pool waiting count** — closed in mode 2.1 (gauge + alert).
- **Worker in-flight slots** — gauge already exists (`vigil_worker_inflight{worker}`).
- **Neo4j mirror pending count** — gauge already exists (`vigil_neo4j_mirror_state_total{state="pending"}`) with an alert at `> 100 for 30m`.

Pre-closure, the Redis stream length had NO metric. Operators couldn't see how close any stream was to the cap until a worker errored on a missing event (or, worse, never noticed because the drop is silent).

## What was added

### 1. `vigil_redis_stream_length{stream}` gauge

`packages/observability/src/metrics.ts` — Prometheus gauge with the stream name as a label.

### 2. `QueueClient.sampleStreamLength(stream)` + `startRedisStreamScraper(client, opts)`

`packages/queue/src/client.ts`:

- `sampleStreamLength(stream)` — single XLEN call that updates the gauge. Returns the length so callers can use it directly.
- `startRedisStreamScraper(client, { intervalMs, streams, logger })` — periodic scraper. Fires once immediately (so the gauge is populated at boot) + on every interval (default 30 s). Returns `{ stop }` for clean shutdown. The interval is `unref()`'d so it doesn't hold the event loop open.

### 3. Per-stream xlen failures are caught + logged at warn

If Redis is briefly unreachable when the scraper ticks, the worker doesn't crash — the failure is logged at warn level with the stream name, and the scraper proceeds to the next stream + the next tick. Tested.

### 4. Two Prometheus alerts

`infra/docker/prometheus/alerts/vigil.yml`:

- **`RedisStreamBackpressure`** — `vigil_redis_stream_length > 500000 for 5m`, severity warning. 50% of the MAXLEN cap.
- **`RedisStreamNearCap`** — `> 900000 for 1m`, severity critical. Within 10% of the cap; oldest-entry-drop imminent.

### 5. Four unit tests

`packages/queue/__tests__/stream-scraper.test.ts`:

1. `sampleStreamLength` calls `xlen(stream)` + sets the gauge with the returned value.
2. `startRedisStreamScraper` fires once immediately + on every interval (verified by call count after 70 ms at 20 ms intervals).
3. `stop()` halts further ticks (verified by call count not growing after stop).
4. `xlen` failures on one stream are caught + logged at warn; the scraper proceeds to other streams + future ticks.

## The invariant

Three layers:

1. **The gauge + scraper** — operators see XLEN per stream every 30 s.
2. **Two alerts** — at 50% (warning) and 90% (critical) of the MAXLEN cap.
3. **Catch-and-continue scraper** — a transient Redis hiccup doesn't lose the gauge for OTHER streams or future ticks.

## What this closure does NOT include

- **Adoption sweep across workers** — `startRedisStreamScraper` exists but no worker currently calls it. Each worker that owns a `QueueClient` should call the scraper once at boot with the list of streams it produces to. Per the binding posture, this is the next incremental step — flagged for Cat-6 follow-up.

- **Stream-specific cap detection** — different streams have different traffic patterns; a one-size-fits-all 500k warning may be noisy for some + lax for others. The current MAXLEN is uniformly 1M across all streams, so 500k is uniformly 50%. If the architect adopts per-stream MAXLEN tuning, the alert thresholds would need to follow.

- **Worker-inflight + db-pool-waiting alerts** — those gauges already exist. `vigil_worker_inflight{worker}` doesn't have an alert today; the orientation flagged this as a "could add" alongside the Redis-stream work. Out of scope; flagged for follow-up. The db-pool-waiting alert was added in mode 2.1 closure.

## Files touched

- `packages/observability/src/metrics.ts` (+15 lines: gauge)
- `packages/queue/src/client.ts` (+50 lines: sampleStreamLength + startRedisStreamScraper)
- `packages/queue/__tests__/stream-scraper.test.ts` (new, 115 lines)
- `infra/docker/prometheus/alerts/vigil.yml` (+19 lines: two alerts)
- `docs/audit/evidence/hardening/category-6/mode-6.8/CLOSURE.md` (this file)

## Verification

- `pnpm --filter @vigil/observability run typecheck` — clean.
- `pnpm --filter @vigil/queue run typecheck` — clean.
- `pnpm --filter @vigil/queue exec vitest run __tests__/stream-scraper.test.ts` — 4/4 pass.
