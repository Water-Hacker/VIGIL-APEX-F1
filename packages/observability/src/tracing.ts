import { SpanStatusCode, trace, type Span, type Tracer } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

/**
 * OpenTelemetry tracing — initialised once per process, before any HTTP /
 * Postgres / Redis / fetch instrumentation runs.
 *
 * Auto-instrumentations are kept conservative; we instrument http, pg, ioredis,
 * and undici by default — DNS/fs/net are too noisy.
 */

let sdk: NodeSDK | null = null;

export interface TracingOptions {
  readonly service: string;
  readonly version?: string;
}

export async function initTracing(opts: TracingOptions): Promise<void> {
  if (sdk) return;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    // Tracing is optional in development; return silently
    return;
  }

  const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });
  const { getNodeAutoInstrumentations } = await import(
    '@opentelemetry/auto-instrumentations-node'
  );

  sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: opts.service,
      [SemanticResourceAttributes.SERVICE_VERSION]: opts.version ?? '0.1.0',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV ?? 'dev',
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

export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = null;
}

/**
 * Get a tracer for a service. Auto-instrumentation gives us spans for
 * HTTP / pg / ioredis / undici; this is the handle workers use to add
 * their own business spans (Phase E1).
 */
export function getServiceTracer(service: string): Tracer {
  return trace.getTracer(service);
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
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  attrs: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span: Span) => {
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined) span.setAttribute(k, v);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
