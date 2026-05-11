/**
 * Bounded undici fetch helpers — AUDIT-093 + AUDIT-095 closure.
 *
 * `undici.request(url, ...)` with no `headersTimeout` / `bodyTimeout`,
 * and `await resp.body.text()` / `.json()` with no size cap, expose
 * the worker to two real failure modes:
 *
 *   1. **Slow loris** — a hostile or misbehaving source holds the
 *      headers / body open indefinitely; the calling worker hangs.
 *   2. **Multi-GB body** — a chunked response of arbitrary size
 *      exhausts the worker's V8 heap before any logic runs.
 *
 * `boundedRequest` adds sane default timeouts. `boundedBodyText`
 * caps total bytes consumed and throws `Errors.SourceParseError` once
 * the cap is exceeded (partial buffer is dropped, never returned).
 *
 * Lives under @vigil/observability because the network-budget concern
 * is cross-cutting (adapter-runner, worker-*, scripts/). The original
 * adapter-local copy at
 * `apps/adapter-runner/src/adapters/_bounded-fetch.ts` now re-exports
 * from here.
 *
 * Defaults:
 *   - headersTimeout 30 s   (matches `scripts/sentinel-tor-check.ts`)
 *   - bodyTimeout    60 s   (longer for large sanctions XML feeds)
 *   - maxBodyBytes   50 MB  (UN / EU / OFAC SDN feeds are a few MB at most)
 *
 * Callers may override either limit per-call.
 */

import { Errors } from '@vigil/shared';
import { request as undiciRequest, type Dispatcher } from 'undici';

export const BOUNDED_FETCH_HEADERS_TIMEOUT_MS = 30_000;
export const BOUNDED_FETCH_BODY_TIMEOUT_MS = 60_000;
export const BOUNDED_BODY_MAX_BYTES = 50_000_000;

/**
 * Mirrors the second parameter of undici's `request(url, options)`:
 * the body-shape from `Dispatcher.RequestOptions` (minus what
 * `undici.request` derives from the URL — origin + path — and with
 * `method` optional because we default it), plus the top-level
 * `dispatcher` opt that the function-style call accepts but the
 * dispatcher-style `RequestOptions` does not.
 */
export type BoundedRequestOptions = Omit<Dispatcher.RequestOptions, 'origin' | 'path' | 'method'> &
  Partial<Pick<Dispatcher.RequestOptions, 'method'>> & {
    dispatcher?: Dispatcher;
  };

export function boundedRequest(
  url: string,
  opts: BoundedRequestOptions = {},
): ReturnType<typeof undiciRequest> {
  return undiciRequest(url, {
    method: 'GET',
    headersTimeout: BOUNDED_FETCH_HEADERS_TIMEOUT_MS,
    bodyTimeout: BOUNDED_FETCH_BODY_TIMEOUT_MS,
    ...opts,
  });
}

/**
 * Consume an undici response body (async iterable of `Buffer` chunks) up to
 * `maxBytes`. Throws `Errors.SourceParseError` once the cap is exceeded — the
 * partial buffer is dropped and never returned to the caller.
 *
 * Generic over the iterable so the helper is unit-testable with synthetic
 * `AsyncIterable<Uint8Array>` inputs without mocking undici.
 */
export async function boundedBodyText(
  body: AsyncIterable<Uint8Array | Buffer>,
  opts: { sourceId: string; url: string; maxBytes?: number },
): Promise<string> {
  const cap = opts.maxBytes ?? BOUNDED_BODY_MAX_BYTES;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > cap) {
      throw new Errors.SourceParseError(opts.sourceId, {
        url: opts.url,
        reason: 'body-exceeds-max-bytes',
        maxBytes: cap,
        observedAtLeastBytes: total,
      });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Convenience: bounded body read + JSON.parse. The JSON.parse step
 * is performed AFTER the byte cap is enforced, so a 10 GB body cannot
 * produce a 10 GB string and then OOM on parse.
 */
export async function boundedBodyJson<T = unknown>(
  body: AsyncIterable<Uint8Array | Buffer>,
  opts: { sourceId: string; url: string; maxBytes?: number },
): Promise<T> {
  const text = await boundedBodyText(body, opts);
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Errors.SourceParseError(opts.sourceId, {
      url: opts.url,
      reason: 'json-parse-failed',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
