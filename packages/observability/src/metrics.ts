import http from 'node:http';

import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
  type LabelValues,
} from 'prom-client';

/**
 * Prometheus metrics — one Registry per process. Workers expose /metrics on
 * port 9100 (env PROMETHEUS_PORT) per SRD §15.6.
 *
 * Naming convention: `vigil_<domain>_<unit>_<aggregation>`.
 */

export const registry = new Registry();
registry.setDefaultLabels({ service: process.env.OTEL_SERVICE_NAME ?? 'vigil-apex' });
collectDefaultMetrics({ register: registry, prefix: 'vigil_node_' });

/* ---- Pre-registered metrics shared across workers --------------------------*/

export const eventsConsumed = new Counter({
  name: 'vigil_events_consumed_total',
  help: 'Events pulled off a Redis stream by a worker',
  labelNames: ['worker', 'stream'] as const,
  registers: [registry],
});

export const eventsEmitted = new Counter({
  name: 'vigil_events_emitted_total',
  help: 'Events written by a worker to a downstream stream',
  labelNames: ['worker', 'stream'] as const,
  registers: [registry],
});

export const dedupHits = new Counter({
  name: 'vigil_dedup_hits_total',
  help: 'Inputs rejected at the dedup boundary',
  labelNames: ['worker'] as const,
  registers: [registry],
});

export const errorsTotal = new Counter({
  name: 'vigil_errors_total',
  help: 'Errors classified by code',
  labelNames: ['service', 'code', 'severity'] as const,
  registers: [registry],
});

export const processingDuration = new Histogram({
  name: 'vigil_processing_duration_seconds',
  help: 'End-to-end processing latency for a unit of work',
  labelNames: ['worker', 'kind'] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

export const dbTransactionDuration = new Histogram({
  name: 'vigil_db_transaction_duration_seconds',
  help: 'Postgres transaction latency',
  labelNames: ['worker', 'op'] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [registry],
});

export const redisAckLatency = new Histogram({
  name: 'vigil_redis_ack_latency_seconds',
  help: 'Time between message receipt and XACK',
  labelNames: ['worker'] as const,
  buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5, 30],
  registers: [registry],
});

export const llmCallsTotal = new Counter({
  name: 'vigil_llm_calls_total',
  help: 'LLM API calls',
  labelNames: ['provider', 'model', 'tier', 'outcome'] as const,
  registers: [registry],
});

// AUDIT-056 — federation-stream client visibility.
export const federationFlushLagMs = new Histogram({
  name: 'vigil_federation_flush_lag_seconds',
  help: 'Wall-clock latency from envelope enqueue to ack returned by the core peer',
  labelNames: ['region'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const federationPendingEnvelopes = new Gauge({
  name: 'vigil_federation_pending_envelopes',
  help: 'Envelopes currently held in the in-process pendingBatch awaiting flush',
  labelNames: ['region'] as const,
  registers: [registry],
});

// AUDIT-058 — Vault token renewal visibility.
export const vaultTokenRenewFailedTotal = new Counter({
  name: 'vigil_vault_token_renew_failed_total',
  help: 'Vault token renewal attempts that returned non-2xx or threw',
  labelNames: ['service'] as const,
  registers: [registry],
});

export const llmCostUsd = new Counter({
  name: 'vigil_llm_cost_usd_total',
  help: 'Cumulative LLM USD cost',
  labelNames: ['provider', 'model'] as const,
  registers: [registry],
});

export const llmTokens = new Counter({
  name: 'vigil_llm_tokens_total',
  help: 'Cumulative input/output tokens',
  labelNames: ['provider', 'model', 'direction'] as const,
  registers: [registry],
});

export const auditChainSeq = new Gauge({
  name: 'vigil_audit_chain_seq',
  help: 'Highest seq committed to the audit chain',
  registers: [registry],
});

export const polygonAnchorSuccess = new Counter({
  name: 'vigil_polygon_anchor_total',
  help: 'Polygon anchor commits',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const adapterRunsTotal = new Counter({
  name: 'vigil_adapter_runs_total',
  help: 'Adapter run outcomes',
  labelNames: ['source', 'outcome'] as const,
  registers: [registry],
});

export const adapterRowsEmitted = new Counter({
  name: 'vigil_adapter_rows_emitted_total',
  help: 'Rows emitted by an adapter',
  labelNames: ['source', 'kind'] as const,
  registers: [registry],
});

/* ---- Phase E2 — business metrics ------------------------------------------*/

/**
 * Distribution of pattern-strength values per pattern. Lets us spot a
 * pattern that has drifted to always-high (likely false positives) or
 * always-low (likely deprecated). 10 bins across [0,1].
 */
export const patternStrength = new Histogram({
  name: 'vigil_pattern_strength',
  help: 'Per-pattern signal strength values',
  labelNames: ['pattern_id'] as const,
  buckets: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
  registers: [registry],
});

/**
 * Per-pattern dispatch outcome timer (AUDIT-059). The `outcome` label
 * lets oncall distinguish "this pattern is slow" (outcome=ok with high
 * upper-percentile) from "this pattern hangs" (outcome=timeout) from
 * "this pattern is buggy" (outcome=error / invalid_result). Without
 * the label all three look identical in a single execution-time
 * histogram.
 */
export const patternEvalDurationMs = new Histogram({
  name: 'vigil_pattern_eval_duration_ms',
  help: 'Wall-clock per pattern dispatch invocation, by pattern_id and outcome',
  labelNames: ['pattern_id', 'outcome'] as const,
  buckets: [5, 25, 100, 250, 500, 1000, 2000, 5000],
  registers: [registry],
});

/**
 * Number of federation peer keys currently loaded from the on-disk
 * key directory (AUDIT-013). When the directory becomes unreadable
 * mid-flight, the receiver silently rejects every federation message
 * thinking no peer is authorised. Setting this to 0 (with the
 * `directory` label) gives oncall an alertable signal:
 *   `vigil_federation_keys_loaded{directory!=""} == 0`
 */
export const federationKeysLoaded = new Gauge({
  name: 'vigil_federation_keys_loaded',
  help: 'Number of federation peer keys loaded from the directory resolver',
  labelNames: ['directory'] as const,
  registers: [registry],
});

/**
 * Turnstile verify outcome counter (AUDIT-015). Distinguishes
 *   outcome=accepted        — Cloudflare returned success:true
 *   outcome=rejected        — Cloudflare returned success:false
 *   outcome=outage          — fetch threw / non-2xx response / timeout
 *   outcome=misconfigured   — TURNSTILE_SECRET_KEY unset at request time
 * so a runbook can distinguish "Turnstile is down" from "users are
 * bots" — both fail closed today, but trigger different responses.
 */
export const tipTurnstileVerifyTotal = new Counter({
  name: 'vigil_tip_turnstile_verify_total',
  help: 'Tip-submit Turnstile verification outcomes',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

/**
 * Posterior at the moment scoring writes it. The /findings dashboard
 * uses the histogram's percentiles to track calibration drift.
 */
export const findingPosterior = new Histogram({
  name: 'vigil_finding_posterior',
  help: 'Distribution of posterior values at scoring time',
  buckets: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1.0],
  registers: [registry],
});

export const dossierRenderDuration = new Histogram({
  name: 'vigil_dossier_render_duration_seconds',
  help: 'End-to-end dossier render time (docx → pdf → IPFS pin)',
  labelNames: ['language'] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [registry],
});

export const minfiScoreBandTotal = new Counter({
  name: 'vigil_minfi_score_band_total',
  help: 'MINFI /score responses by band',
  labelNames: ['band'] as const,
  registers: [registry],
});

export const councilVoteTotal = new Counter({
  name: 'vigil_council_vote_total',
  help: 'Council votes recorded',
  labelNames: ['choice', 'pillar'] as const,
  registers: [registry],
});

/**
 * Postgres pool saturation gauge — Phase D1's `poolStats(pool)` exporter
 * is wired here. Sample every metrics-scrape (Prometheus default 15 s).
 */
export const dbPoolTotal = new Gauge({
  name: 'vigil_db_pool_total',
  help: 'Total Postgres pool size',
  registers: [registry],
});

export const dbPoolIdle = new Gauge({
  name: 'vigil_db_pool_idle',
  help: 'Idle Postgres pool connections',
  registers: [registry],
});

export const dbPoolWaiting = new Gauge({
  name: 'vigil_db_pool_waiting',
  help: 'Postgres pool waiting requests (saturation indicator)',
  registers: [registry],
});

/**
 * Hardening mode 2.8 — optimistic-lock CAS conflict counter. Incremented
 * every time a repo setter that received `expectedRevision` finds the
 * row's actual revision did not match (concurrent writer detected). The
 * caller surfaces the conflict via `CasConflictError`; the metric makes
 * the contention visible to operators even when callers retry silently.
 */
export const repoCasConflictTotal = new Counter({
  name: 'vigil_repo_cas_conflict_total',
  help: 'Optimistic-lock CAS conflicts detected by repo setters (mode 2.8)',
  labelNames: ['repo', 'fn'] as const,
  registers: [registry],
});

/**
 * In-flight gauge for adaptive concurrency (D9). Each worker reports its
 * own slot count.
 */
export const workerInflight = new Gauge({
  name: 'vigil_worker_inflight',
  help: 'In-flight handler invocations per worker',
  labelNames: ['worker'] as const,
  registers: [registry],
});

/**
 * Last-tick wall clock per worker, in seconds since the Unix epoch
 * (AUDIT-076). Updated on every consume-loop iteration in
 * packages/queue/src/worker.ts. The Prometheus alert
 * `vigil_apex.WorkerLoopStalled` fires when `time() - this gauge` >
 * 1 hour, which catches a worker stuck in a degraded state long
 * before /healthz returns red.
 */
export const workerLastTickSeconds = new Gauge({
  name: 'vigil_worker_last_tick_seconds',
  help: 'Wall clock of the most recent consume-loop iteration per worker, seconds since epoch',
  labelNames: ['worker'] as const,
  registers: [registry],
});

export const workerEffectiveConcurrency = new Gauge({
  name: 'vigil_worker_effective_concurrency',
  help: 'Effective concurrency after adaptive throttling',
  labelNames: ['worker'] as const,
  registers: [registry],
});

export const ipfsPinsTotal = new Counter({
  name: 'vigil_ipfs_pins_total',
  help: 'IPFS pin attempts',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

/**
 * Block-A reconciliation §5.b — count of entity.canonical rows
 * grouped by neo4j_mirror_state. worker-entity pushes this gauge on
 * a periodic tick (default every 60s) by calling
 * EntityRepo.neo4jMirrorStateCounts(). Alertable signals:
 *   vigil_neo4j_mirror_state_total{state="failed"} > 0   — page oncall
 *   vigil_neo4j_mirror_state_total{state="pending"} > 100 for 30m — warn
 */
export const neo4jMirrorStateTotal = new Gauge({
  name: 'vigil_neo4j_mirror_state_total',
  help: 'Count of entity.canonical rows grouped by neo4j_mirror_state',
  labelNames: ['state'] as const,
  registers: [registry],
});

/**
 * Block-E E.11 / A5.4 — quarterly salt-collision count.
 *
 * The TAL-PA quarterly export's salt rotation is observed via the view
 * `audit.public_export_salt_collisions`. The salt-collision-check trigger
 * sets this gauge to the row-count it observes; alertmanager fires when
 * `> 0` for any sustained interval. Cardinality is 0 (no labels) — it's
 * a global health gauge.
 */
export const auditSaltCollisionsTotal = new Gauge({
  name: 'vigil_audit_salt_collisions_total',
  help: 'Pairs of consecutive audit.public_export rows sharing salt_fingerprint (forgotten-rotation indicator)',
  registers: [registry],
});

export type Labels<T extends string> = LabelValues<T>;

/** Start a tiny HTTP server that serves /metrics. */
export interface MetricsServer {
  readonly close: () => Promise<void>;
  readonly url: string;
}

export async function startMetricsServer(
  port = Number(process.env.PROMETHEUS_PORT ?? 9100),
): Promise<MetricsServer> {
  const server = http.createServer((req, res) => {
    if (req.url === '/metrics' && req.method === 'GET') {
      void registry
        .metrics()
        .then((body) => {
          res.writeHead(200, { 'Content-Type': registry.contentType });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(500);
          res.end('metrics unavailable');
        });
    } else if (req.url === '/healthz' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ok"}');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve());
  });

  return {
    url: `http://0.0.0.0:${port}/metrics`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export { Counter, Gauge, Histogram };
