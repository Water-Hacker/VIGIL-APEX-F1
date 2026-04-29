import { type Span, type Tracer } from '@opentelemetry/api';
export interface TracingOptions {
    readonly service: string;
    readonly version?: string;
}
export declare function initTracing(opts: TracingOptions): Promise<void>;
export declare function shutdownTracing(): Promise<void>;
/**
 * Get a tracer for a service. Auto-instrumentation gives us spans for
 * HTTP / pg / ioredis / undici; this is the handle workers use to add
 * their own business spans (Phase E1).
 */
export declare function getServiceTracer(service: string): Tracer;
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
export declare function withSpan<T>(tracer: Tracer, name: string, attrs: Record<string, string | number | boolean | undefined>, fn: (span: Span) => Promise<T>): Promise<T>;
//# sourceMappingURL=tracing.d.ts.map