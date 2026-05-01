/**
 * AUDIT-093 — pin the bounded undici fetch helpers.
 *
 * Phase-1 description:
 *   `apiJsonFetch` and `pdfLinkScrape` consume `await resp.body.text()` with
 *   no body-size cap and no `headersTimeout` / `bodyTimeout` on the underlying
 *   `request()`. AUDIT-036 closed the same class for federation-receiver CRL
 *   parsing; the adapter-runner network helpers were missed.
 *
 * Closure: introduce `boundedRequest` (carries default timeouts into undici)
 * and `boundedBodyText` (consumes the response body's async iterator and
 * throws `Errors.SourceParseError` once a configurable `maxBytes` is exceeded).
 *
 * Tests pin:
 *   1. Defaults are non-zero and sane.
 *   2. boundedBodyText returns the full text when the body is below the cap.
 *   3. boundedBodyText accepts both Buffer and Uint8Array chunks.
 *   4. boundedBodyText throws SourceParseError exactly when total >= cap+1.
 *   5. The thrown error is the canonical `Errors.SourceParseError` shape with
 *      the `body-exceeds-max-bytes` reason and the source/url context.
 *   6. Source-grep guards: `_helpers.ts` no longer calls bare `request()` /
 *      `resp.body.text()`; both call sites route through the bounded helpers.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Errors } from '@vigil/shared';
import { describe, expect, it } from 'vitest';

import {
  BOUNDED_BODY_MAX_BYTES,
  BOUNDED_FETCH_BODY_TIMEOUT_MS,
  BOUNDED_FETCH_HEADERS_TIMEOUT_MS,
  boundedBodyText,
} from '../src/adapters/_bounded-fetch';

async function* fromChunks(chunks: ReadonlyArray<Uint8Array | Buffer>): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield c;
}

describe('AUDIT-093 — bounded fetch defaults are sane', () => {
  it('headers timeout default is finite and >= 5 s', () => {
    expect(BOUNDED_FETCH_HEADERS_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(Number.isFinite(BOUNDED_FETCH_HEADERS_TIMEOUT_MS)).toBe(true);
  });

  it('body timeout default is finite and >= headers timeout', () => {
    expect(BOUNDED_FETCH_BODY_TIMEOUT_MS).toBeGreaterThanOrEqual(BOUNDED_FETCH_HEADERS_TIMEOUT_MS);
    expect(Number.isFinite(BOUNDED_FETCH_BODY_TIMEOUT_MS)).toBe(true);
  });

  it('max body bytes default is at least 1 MB and at most 200 MB', () => {
    expect(BOUNDED_BODY_MAX_BYTES).toBeGreaterThanOrEqual(1_000_000);
    expect(BOUNDED_BODY_MAX_BYTES).toBeLessThanOrEqual(200_000_000);
  });
});

describe('AUDIT-093 — boundedBodyText happy paths', () => {
  it('returns the full utf-8 text when body is below the cap', async () => {
    const body = fromChunks([Buffer.from('hello '), Buffer.from('world')]);
    const text = await boundedBodyText(body, { sourceId: 'test', url: 'http://x' });
    expect(text).toBe('hello world');
  });

  it('accepts Uint8Array chunks (not just Buffer)', async () => {
    const body = fromChunks([new Uint8Array([0x68, 0x69])]); // "hi"
    const text = await boundedBodyText(body, { sourceId: 'test', url: 'http://x' });
    expect(text).toBe('hi');
  });

  it('returns empty string for an empty body', async () => {
    const body = fromChunks([]);
    const text = await boundedBodyText(body, { sourceId: 'test', url: 'http://x' });
    expect(text).toBe('');
  });

  it('returns exact-cap-sized body without throwing (boundary at cap, not cap+1)', async () => {
    const cap = 16;
    const buf = Buffer.alloc(cap, 0x61); // 16 × 'a'
    const text = await boundedBodyText(fromChunks([buf]), {
      sourceId: 'test',
      url: 'http://x',
      maxBytes: cap,
    });
    expect(text).toHaveLength(cap);
  });
});

describe('AUDIT-093 — boundedBodyText rejects oversize bodies', () => {
  it('throws SourceParseError once the running total exceeds maxBytes', async () => {
    const cap = 16;
    const oversize = Buffer.alloc(cap + 1, 0x61);
    await expect(
      boundedBodyText(fromChunks([oversize]), {
        sourceId: 'test-source',
        url: 'http://example.test',
        maxBytes: cap,
      }),
    ).rejects.toBeInstanceOf(Errors.SourceParseError);
  });

  it('SourceParseError carries the body-exceeds-max-bytes reason + context', async () => {
    const cap = 8;
    const oversize = Buffer.alloc(cap + 4, 0x61);
    let err: unknown;
    try {
      await boundedBodyText(fromChunks([oversize]), {
        sourceId: 'minfi',
        url: 'http://example.test/xml',
        maxBytes: cap,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Errors.SourceParseError);
    const v = err as Errors.SourceParseError;
    expect(v.context).toMatchObject({
      source: 'minfi',
      url: 'http://example.test/xml',
      reason: 'body-exceeds-max-bytes',
      maxBytes: cap,
    });
    expect((v.context as { observedAtLeastBytes: number }).observedAtLeastBytes).toBeGreaterThan(
      cap,
    );
  });

  it('throws on the first oversize chunk (does not buffer the entire body)', async () => {
    // We assert this indirectly: if the helper accumulated all chunks before
    // checking, the error context's `observedAtLeastBytes` would be
    // sum(all chunks). Instead, it should be the running total at the moment
    // the cap was first exceeded, which is at most cap + chunkSize.
    const cap = 100;
    const chunkA = Buffer.alloc(80, 0x61);
    const chunkB = Buffer.alloc(80, 0x62); // pushes total to 160 (over cap)
    const chunkC = Buffer.alloc(10_000, 0x63); // never consumed if early-throw
    let err: Errors.SourceParseError | null = null;
    try {
      await boundedBodyText(fromChunks([chunkA, chunkB, chunkC]), {
        sourceId: 's',
        url: 'http://x',
        maxBytes: cap,
      });
    } catch (e) {
      err = e as Errors.SourceParseError;
    }
    expect(err).not.toBeNull();
    const observed = (err!.context as { observedAtLeastBytes: number }).observedAtLeastBytes;
    expect(observed).toBeLessThan(10_000); // chunkC never consumed
    expect(observed).toBeGreaterThan(cap);
  });
});

describe('AUDIT-093 — _helpers.ts source guards', () => {
  it('_helpers.ts does not call undici request() directly', () => {
    const src = readFileSync(join(__dirname, '../src/adapters/_helpers.ts'), 'utf8');
    // The `import { request } from 'undici'` line should be gone.
    expect(src).not.toMatch(/import\s*\{[^}]*\brequest\b[^}]*\}\s*from\s*['"]undici['"]/);
  });

  it('_helpers.ts does not call resp.body.text() directly', () => {
    const src = readFileSync(join(__dirname, '../src/adapters/_helpers.ts'), 'utf8');
    expect(src).not.toMatch(/resp\.body\.text\(\)/);
  });

  it('_helpers.ts routes through boundedRequest + boundedBodyText', () => {
    const src = readFileSync(join(__dirname, '../src/adapters/_helpers.ts'), 'utf8');
    expect(src).toMatch(/boundedRequest\(/);
    expect(src).toMatch(/boundedBodyText\(/);
  });
});
