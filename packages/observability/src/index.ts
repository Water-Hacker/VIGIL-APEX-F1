/**
 * @vigil/observability — root barrel.
 *
 * Per SRD §15.6: every worker exposes `/metrics` (Prometheus), structured
 * JSON logs via pino with `trace_id, span_id, event_id, worker` propagated,
 * and OpenTelemetry traces over OTLP/HTTP.
 */
export * from './logger.js';
export * from './metrics.js';
export * from './tracing.js';
export * from './correlation.js';
export * from './shutdown.js';
export * from './sentinel-quorum.js';
export * from './bounded-fetch.js';
export * from './loop-backoff.js';
