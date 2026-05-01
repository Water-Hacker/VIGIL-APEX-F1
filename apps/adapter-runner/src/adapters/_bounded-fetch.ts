import { Errors } from '@vigil/shared';
import { request as undiciRequest, type Dispatcher } from 'undici';

/**
 * AUDIT-093 — bounded undici fetch helpers.
 *
 * `apiJsonFetch` + `pdfLinkScrape` previously called `undici.request(url, ...)`
 * with no `headersTimeout` / `bodyTimeout` and consumed `await resp.body.text()`
 * with no body-size cap. A hostile or misbehaving source returning a multi-GB
 * body (or a slow-loris stall) could exhaust adapter-runner heap or hang the
 * trigger indefinitely.
 *
 * AUDIT-036 closed the same class of issue for the federation-receiver CRL
 * parser; this module is the equivalent for the adapter-runner network path.
 *
 * Defaults:
 *   - headersTimeout 30 s   (matches `scripts/sentinel-tor-check.ts`)
 *   - bodyTimeout    60 s   (longer for large sanctions XML feeds)
 *   - maxBodyBytes   50 MB  (UN / EU / OFAC SDN feeds are a few MB at most)
 *
 * Callers may override either limit per-call.
 */

export const BOUNDED_FETCH_HEADERS_TIMEOUT_MS = 30_000;
export const BOUNDED_FETCH_BODY_TIMEOUT_MS = 60_000;
export const BOUNDED_BODY_MAX_BYTES = 50_000_000;

export type BoundedRequestOptions = Omit<Dispatcher.RequestOptions, 'origin' | 'path' | 'method'> &
  Partial<Pick<Dispatcher.RequestOptions, 'method'>>;

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
