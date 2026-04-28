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

export type Labels<T extends string> = LabelValues<T>;

/** Start a tiny HTTP server that serves /metrics. */
export interface MetricsServer {
  readonly close: () => Promise<void>;
  readonly url: string;
}

export async function startMetricsServer(port = Number(process.env.PROMETHEUS_PORT ?? 9100)): Promise<MetricsServer> {
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
