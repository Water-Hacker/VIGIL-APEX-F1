import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Correlation ID propagation via AsyncLocalStorage.
 *
 * Every request / message / job carries one `correlation_id`; downstream code
 * pulls it from `getCorrelationId()` to attach to logs and outbound calls.
 */

interface CorrelationCtx {
  readonly correlationId: string;
  readonly worker?: string;
}

const als = new AsyncLocalStorage<CorrelationCtx>();

export function withCorrelation<T>(
  correlationId: string,
  worker: string | undefined,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return als.run({ correlationId, ...(worker !== undefined && { worker }) }, fn);
}

export function getCorrelationId(): string | undefined {
  return als.getStore()?.correlationId;
}

export function getWorkerName(): string | undefined {
  return als.getStore()?.worker;
}

export function newCorrelationId(): string {
  return randomUUID();
}
