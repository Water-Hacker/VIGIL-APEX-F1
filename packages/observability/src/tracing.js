"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initTracing = initTracing;
exports.shutdownTracing = shutdownTracing;
exports.getServiceTracer = getServiceTracer;
exports.withSpan = withSpan;
const exporter_trace_otlp_http_1 = require("@opentelemetry/exporter-trace-otlp-http");
const resources_1 = require("@opentelemetry/resources");
const sdk_node_1 = require("@opentelemetry/sdk-node");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const api_1 = require("@opentelemetry/api");
/**
 * OpenTelemetry tracing — initialised once per process, before any HTTP /
 * Postgres / Redis / fetch instrumentation runs.
 *
 * Auto-instrumentations are kept conservative; we instrument http, pg, ioredis,
 * and undici by default — DNS/fs/net are too noisy.
 */
let sdk = null;
async function initTracing(opts) {
    if (sdk)
        return;
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (!endpoint) {
        // Tracing is optional in development; return silently
        return;
    }
    const exporter = new exporter_trace_otlp_http_1.OTLPTraceExporter({ url: `${endpoint}/v1/traces` });
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
    sdk = new sdk_node_1.NodeSDK({
        resource: new resources_1.Resource({
            [semantic_conventions_1.SemanticResourceAttributes.SERVICE_NAME]: opts.service,
            [semantic_conventions_1.SemanticResourceAttributes.SERVICE_VERSION]: opts.version ?? '0.1.0',
            [semantic_conventions_1.SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV ?? 'dev',
        }),
        traceExporter: exporter,
        instrumentations: [
            getNodeAutoInstrumentations({
                '@opentelemetry/instrumentation-fs': { enabled: false },
                '@opentelemetry/instrumentation-net': { enabled: false },
                '@opentelemetry/instrumentation-dns': { enabled: false },
                '@opentelemetry/instrumentation-http': { enabled: true },
                '@opentelemetry/instrumentation-undici': { enabled: true },
                '@opentelemetry/instrumentation-pg': { enabled: true },
                '@opentelemetry/instrumentation-ioredis': { enabled: true },
            }),
        ],
    });
    sdk.start();
}
async function shutdownTracing() {
    if (!sdk)
        return;
    await sdk.shutdown();
    sdk = null;
}
/**
 * Get a tracer for a service. Auto-instrumentation gives us spans for
 * HTTP / pg / ioredis / undici; this is the handle workers use to add
 * their own business spans (Phase E1).
 */
function getServiceTracer(service) {
    return api_1.trace.getTracer(service);
}
/**
 * Run `fn` inside a child span named `name`, attaching the supplied
 * attributes. Records exceptions and sets the span status correctly.
 * Pattern matches `withCorrelation` so handlers compose them naturally:
 *
 *   await withCorrelation(env.correlation_id, name, () =>
 *     withSpan(tracer, 'worker.pattern.handle',
 *       { finding_id, pattern_id }, () => this.handle(env)),
 *   );
 */
async function withSpan(tracer, name, attrs, fn) {
    return tracer.startActiveSpan(name, async (span) => {
        for (const [k, v] of Object.entries(attrs)) {
            if (v !== undefined)
                span.setAttribute(k, v);
        }
        try {
            const result = await fn(span);
            span.setStatus({ code: api_1.SpanStatusCode.OK });
            return result;
        }
        catch (err) {
            span.recordException(err);
            span.setStatus({
                code: api_1.SpanStatusCode.ERROR,
                message: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
        finally {
            span.end();
        }
    });
}
//# sourceMappingURL=tracing.js.map