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
