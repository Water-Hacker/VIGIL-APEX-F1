"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Histogram = exports.Gauge = exports.Counter = exports.ipfsPinsTotal = exports.workerEffectiveConcurrency = exports.workerInflight = exports.dbPoolWaiting = exports.dbPoolIdle = exports.dbPoolTotal = exports.councilVoteTotal = exports.minfiScoreBandTotal = exports.dossierRenderDuration = exports.findingPosterior = exports.patternStrength = exports.adapterRowsEmitted = exports.adapterRunsTotal = exports.polygonAnchorSuccess = exports.auditChainSeq = exports.llmTokens = exports.llmCostUsd = exports.llmCallsTotal = exports.redisAckLatency = exports.dbTransactionDuration = exports.processingDuration = exports.errorsTotal = exports.dedupHits = exports.eventsEmitted = exports.eventsConsumed = exports.registry = void 0;
exports.startMetricsServer = startMetricsServer;
const node_http_1 = __importDefault(require("node:http"));
const prom_client_1 = require("prom-client");
Object.defineProperty(exports, "Counter", { enumerable: true, get: function () { return prom_client_1.Counter; } });
Object.defineProperty(exports, "Gauge", { enumerable: true, get: function () { return prom_client_1.Gauge; } });
Object.defineProperty(exports, "Histogram", { enumerable: true, get: function () { return prom_client_1.Histogram; } });
/**
 * Prometheus metrics — one Registry per process. Workers expose /metrics on
 * port 9100 (env PROMETHEUS_PORT) per SRD §15.6.
 *
 * Naming convention: `vigil_<domain>_<unit>_<aggregation>`.
 */
exports.registry = new prom_client_1.Registry();
exports.registry.setDefaultLabels({ service: process.env.OTEL_SERVICE_NAME ?? 'vigil-apex' });
(0, prom_client_1.collectDefaultMetrics)({ register: exports.registry, prefix: 'vigil_node_' });
/* ---- Pre-registered metrics shared across workers --------------------------*/
exports.eventsConsumed = new prom_client_1.Counter({
    name: 'vigil_events_consumed_total',
    help: 'Events pulled off a Redis stream by a worker',
    labelNames: ['worker', 'stream'],
    registers: [exports.registry],
});
exports.eventsEmitted = new prom_client_1.Counter({
    name: 'vigil_events_emitted_total',
    help: 'Events written by a worker to a downstream stream',
    labelNames: ['worker', 'stream'],
    registers: [exports.registry],
});
exports.dedupHits = new prom_client_1.Counter({
    name: 'vigil_dedup_hits_total',
    help: 'Inputs rejected at the dedup boundary',
    labelNames: ['worker'],
    registers: [exports.registry],
});
exports.errorsTotal = new prom_client_1.Counter({
    name: 'vigil_errors_total',
    help: 'Errors classified by code',
    labelNames: ['service', 'code', 'severity'],
    registers: [exports.registry],
});
exports.processingDuration = new prom_client_1.Histogram({
    name: 'vigil_processing_duration_seconds',
    help: 'End-to-end processing latency for a unit of work',
    labelNames: ['worker', 'kind'],
    buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
    registers: [exports.registry],
});
exports.dbTransactionDuration = new prom_client_1.Histogram({
    name: 'vigil_db_transaction_duration_seconds',
    help: 'Postgres transaction latency',
    labelNames: ['worker', 'op'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [exports.registry],
});
exports.redisAckLatency = new prom_client_1.Histogram({
    name: 'vigil_redis_ack_latency_seconds',
    help: 'Time between message receipt and XACK',
    labelNames: ['worker'],
    buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5, 30],
    registers: [exports.registry],
});
exports.llmCallsTotal = new prom_client_1.Counter({
    name: 'vigil_llm_calls_total',
    help: 'LLM API calls',
    labelNames: ['provider', 'model', 'tier', 'outcome'],
    registers: [exports.registry],
});
exports.llmCostUsd = new prom_client_1.Counter({
    name: 'vigil_llm_cost_usd_total',
    help: 'Cumulative LLM USD cost',
    labelNames: ['provider', 'model'],
    registers: [exports.registry],
});
exports.llmTokens = new prom_client_1.Counter({
    name: 'vigil_llm_tokens_total',
    help: 'Cumulative input/output tokens',
    labelNames: ['provider', 'model', 'direction'],
    registers: [exports.registry],
});
exports.auditChainSeq = new prom_client_1.Gauge({
    name: 'vigil_audit_chain_seq',
    help: 'Highest seq committed to the audit chain',
    registers: [exports.registry],
});
exports.polygonAnchorSuccess = new prom_client_1.Counter({
    name: 'vigil_polygon_anchor_total',
    help: 'Polygon anchor commits',
    labelNames: ['outcome'],
    registers: [exports.registry],
});
exports.adapterRunsTotal = new prom_client_1.Counter({
    name: 'vigil_adapter_runs_total',
    help: 'Adapter run outcomes',
    labelNames: ['source', 'outcome'],
    registers: [exports.registry],
});
exports.adapterRowsEmitted = new prom_client_1.Counter({
    name: 'vigil_adapter_rows_emitted_total',
    help: 'Rows emitted by an adapter',
    labelNames: ['source', 'kind'],
    registers: [exports.registry],
});
/* ---- Phase E2 — business metrics ------------------------------------------*/
/**
 * Distribution of pattern-strength values per pattern. Lets us spot a
 * pattern that has drifted to always-high (likely false positives) or
 * always-low (likely deprecated). 10 bins across [0,1].
 */
exports.patternStrength = new prom_client_1.Histogram({
    name: 'vigil_pattern_strength',
    help: 'Per-pattern signal strength values',
    labelNames: ['pattern_id'],
    buckets: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    registers: [exports.registry],
});
/**
 * Posterior at the moment scoring writes it. The /findings dashboard
 * uses the histogram's percentiles to track calibration drift.
 */
exports.findingPosterior = new prom_client_1.Histogram({
    name: 'vigil_finding_posterior',
    help: 'Distribution of posterior values at scoring time',
    buckets: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1.0],
    registers: [exports.registry],
});
exports.dossierRenderDuration = new prom_client_1.Histogram({
    name: 'vigil_dossier_render_duration_seconds',
    help: 'End-to-end dossier render time (docx → pdf → IPFS pin)',
    labelNames: ['language'],
    buckets: [1, 5, 10, 30, 60, 120, 300, 600],
    registers: [exports.registry],
});
exports.minfiScoreBandTotal = new prom_client_1.Counter({
    name: 'vigil_minfi_score_band_total',
    help: 'MINFI /score responses by band',
    labelNames: ['band'],
    registers: [exports.registry],
});
exports.councilVoteTotal = new prom_client_1.Counter({
    name: 'vigil_council_vote_total',
    help: 'Council votes recorded',
    labelNames: ['choice', 'pillar'],
    registers: [exports.registry],
});
/**
 * Postgres pool saturation gauge — Phase D1's `poolStats(pool)` exporter
 * is wired here. Sample every metrics-scrape (Prometheus default 15 s).
 */
exports.dbPoolTotal = new prom_client_1.Gauge({
    name: 'vigil_db_pool_total',
    help: 'Total Postgres pool size',
    registers: [exports.registry],
});
exports.dbPoolIdle = new prom_client_1.Gauge({
    name: 'vigil_db_pool_idle',
    help: 'Idle Postgres pool connections',
    registers: [exports.registry],
});
exports.dbPoolWaiting = new prom_client_1.Gauge({
    name: 'vigil_db_pool_waiting',
    help: 'Postgres pool waiting requests (saturation indicator)',
    registers: [exports.registry],
});
/**
 * In-flight gauge for adaptive concurrency (D9). Each worker reports its
 * own slot count.
 */
exports.workerInflight = new prom_client_1.Gauge({
    name: 'vigil_worker_inflight',
    help: 'In-flight handler invocations per worker',
    labelNames: ['worker'],
    registers: [exports.registry],
});
exports.workerEffectiveConcurrency = new prom_client_1.Gauge({
    name: 'vigil_worker_effective_concurrency',
    help: 'Effective concurrency after adaptive throttling',
    labelNames: ['worker'],
    registers: [exports.registry],
});
exports.ipfsPinsTotal = new prom_client_1.Counter({
    name: 'vigil_ipfs_pins_total',
    help: 'IPFS pin attempts',
    labelNames: ['outcome'],
    registers: [exports.registry],
});
async function startMetricsServer(port = Number(process.env.PROMETHEUS_PORT ?? 9100)) {
    const server = node_http_1.default.createServer((req, res) => {
        if (req.url === '/metrics' && req.method === 'GET') {
            void exports.registry
                .metrics()
                .then((body) => {
                res.writeHead(200, { 'Content-Type': exports.registry.contentType });
                res.end(body);
            })
                .catch(() => {
                res.writeHead(500);
                res.end('metrics unavailable');
            });
        }
        else if (req.url === '/healthz' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"status":"ok"}');
        }
        else {
            res.writeHead(404);
            res.end();
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '0.0.0.0', () => resolve());
    });
    return {
        url: `http://0.0.0.0:${port}/metrics`,
        close: () => new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        }),
    };
}
//# sourceMappingURL=metrics.js.map