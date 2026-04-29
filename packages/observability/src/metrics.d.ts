import { Counter, Gauge, Histogram, Registry, type LabelValues } from 'prom-client';
/**
 * Prometheus metrics — one Registry per process. Workers expose /metrics on
 * port 9100 (env PROMETHEUS_PORT) per SRD §15.6.
 *
 * Naming convention: `vigil_<domain>_<unit>_<aggregation>`.
 */
export declare const registry: Registry<"text/plain; version=0.0.4; charset=utf-8">;
export declare const eventsConsumed: Counter<"worker" | "stream">;
export declare const eventsEmitted: Counter<"worker" | "stream">;
export declare const dedupHits: Counter<"worker">;
export declare const errorsTotal: Counter<"code" | "service" | "severity">;
export declare const processingDuration: Histogram<"worker" | "kind">;
export declare const dbTransactionDuration: Histogram<"worker" | "op">;
export declare const redisAckLatency: Histogram<"worker">;
export declare const llmCallsTotal: Counter<"provider" | "model" | "tier" | "outcome">;
export declare const llmCostUsd: Counter<"provider" | "model">;
export declare const llmTokens: Counter<"provider" | "model" | "direction">;
export declare const auditChainSeq: Gauge<string>;
export declare const polygonAnchorSuccess: Counter<"outcome">;
export declare const adapterRunsTotal: Counter<"outcome" | "source">;
export declare const adapterRowsEmitted: Counter<"kind" | "source">;
/**
 * Distribution of pattern-strength values per pattern. Lets us spot a
 * pattern that has drifted to always-high (likely false positives) or
 * always-low (likely deprecated). 10 bins across [0,1].
 */
export declare const patternStrength: Histogram<"pattern_id">;
/**
 * Posterior at the moment scoring writes it. The /findings dashboard
 * uses the histogram's percentiles to track calibration drift.
 */
export declare const findingPosterior: Histogram<string>;
export declare const dossierRenderDuration: Histogram<"language">;
export declare const minfiScoreBandTotal: Counter<"band">;
export declare const councilVoteTotal: Counter<"choice" | "pillar">;
/**
 * Postgres pool saturation gauge — Phase D1's `poolStats(pool)` exporter
 * is wired here. Sample every metrics-scrape (Prometheus default 15 s).
 */
export declare const dbPoolTotal: Gauge<string>;
export declare const dbPoolIdle: Gauge<string>;
export declare const dbPoolWaiting: Gauge<string>;
/**
 * In-flight gauge for adaptive concurrency (D9). Each worker reports its
 * own slot count.
 */
export declare const workerInflight: Gauge<"worker">;
export declare const workerEffectiveConcurrency: Gauge<"worker">;
export declare const ipfsPinsTotal: Counter<"outcome">;
export type Labels<T extends string> = LabelValues<T>;
/** Start a tiny HTTP server that serves /metrics. */
export interface MetricsServer {
    readonly close: () => Promise<void>;
    readonly url: string;
}
export declare function startMetricsServer(port?: number): Promise<MetricsServer>;
export { Counter, Gauge, Histogram };
//# sourceMappingURL=metrics.d.ts.map