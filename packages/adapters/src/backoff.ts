import { setTimeout as sleep } from 'node:timers/promises';

/**
 * runWithBackoff — exponential backoff for transient adapter fetches.
 *
 * Retries on `5xx`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`. Does NOT retry
 * 4xx — those go straight to the adapter base's first-contact handler.
 *
 * Default schedule: 3 attempts at 0/10s/30s. Override via opts.
 */

export interface BackoffOptions {
  readonly attempts?: number;
  readonly delaysMs?: readonly number[];
  readonly isRetryable?: (err: unknown) => boolean;
}

export function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    if (/(?:ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up)/i.test(msg)) {
      return true;
    }
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && /(?:ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)/i.test(code)) {
      return true;
    }
    const status = (err as { status?: unknown; statusCode?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && status >= 500 && status < 600) return true;
  }
  return false;
}

export async function runWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  opts: BackoffOptions = {},
): Promise<T> {
  const delaysMs = opts.delaysMs ?? [0, 10_000, 30_000];
  const attempts = opts.attempts ?? delaysMs.length;
  const isRetryable = opts.isRetryable ?? isTransientError;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      const d = delaysMs[i] ?? delaysMs[delaysMs.length - 1] ?? 0;
      if (d > 0) await sleep(d);
    }
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e)) throw e;
    }
  }
  throw lastErr;
}
