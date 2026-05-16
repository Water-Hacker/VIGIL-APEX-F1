/**
 * Mode 7.9 — Unbounded input size causing resource exhaustion.
 *
 * The two public-facing tip routes each have a documented hard size
 * cap that returns 413 Payload Too Large. Pre-closure, no test
 * exercised these caps; a future PR could remove the Content-Length
 * check and the regression would only surface in a real attack.
 *
 * These integration tests POST oversized synthetic requests against
 * the actual route handlers and assert:
 *   - tip-submit: Content-Length > 256 KB → 413 + opaque error code.
 *   - tip-attachment: arrayBuffer.byteLength > 10 MB + 32 KB → 413.
 * The 413 path short-circuits BEFORE any side effects (no DB write,
 * no Turnstile verify, no audit emit) — the response is determined
 * by the size check alone, so the test needs no test fixtures.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { POST as attachmentPost } from '../src/app/api/tip/attachment/route';
import { POST as submitPost } from '../src/app/api/tip/submit/route';

describe('mode 7.9 — tip-submit oversized JSON body → 413', () => {
  it('rejects a body with Content-Length > 256 KB before parsing', async () => {
    // 300 KB > 256 KB cap. Content-Length is the request header the
    // route inspects; the actual body is not consumed (the 413 short-
    // circuits before req.json() runs).
    const oversizedBodyClaim = '0'.repeat(300 * 1024);
    const req = new NextRequest('http://localhost/api/tip/submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(oversizedBodyClaim.length),
      },
      body: oversizedBodyClaim,
    });
    const res = await submitPost(req);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('payload-too-large');
  });

  it('accepts requests with Content-Length under the cap (the cap is a ceiling, not a floor)', async () => {
    // Content-Length just above the schema's actual limits but under
    // the 256 KB hard cap. The schema will reject the body content;
    // we only want to confirm that the size check does NOT 413.
    const smallBody = JSON.stringify({ tiny: 'object' });
    const req = new NextRequest('http://localhost/api/tip/submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(smallBody.length),
      },
      body: smallBody,
    });
    const res = await submitPost(req);
    // The body fails schema validation (400) or content-type check;
    // crucially the response is NOT 413 — the size check passed.
    expect(res.status).not.toBe(413);
  });

  it('rejects non-JSON content-type with 415 BEFORE the size check (regression for content-type-guard ordering)', async () => {
    const req = new NextRequest('http://localhost/api/tip/submit', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'content-length': '10',
      },
      body: 'not json',
    });
    const res = await submitPost(req);
    expect(res.status).toBe(415);
  });
});

describe('mode 7.9 — tip-attachment oversized binary body → 413', () => {
  it('rejects an arrayBuffer larger than the 10 MB + 32 KB cap', async () => {
    // 11 MB > MAX_BLOB_BYTES (10 MB + 32 KB slack). The route reads
    // the full arrayBuffer first (so the request body IS consumed),
    // then checks `ab.byteLength > MAX_BLOB_BYTES` and returns 413.
    const oversized = new Uint8Array(11 * 1024 * 1024);
    // Fill with a small non-zero pattern so the cheap "all-zero
    // prefix" sanity check at line 102 would PASS — proving the 413
    // fires on size, not on content.
    for (let i = 0; i < 16; i++) oversized[i] = (i + 1) & 0xff;

    const req = new NextRequest('http://localhost/api/tip/attachment', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-libsodium-sealed-box',
        // Simulate a rate-limit-allowed IP. The route's rate limiter
        // is an in-memory Map; first request from this IP is allowed.
        'x-forwarded-for': '10.0.0.99',
      },
      body: oversized,
    });
    const res = await attachmentPost(req);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('too-large');
  });

  it('rejects an empty body with 400 before the size check', async () => {
    const req = new NextRequest('http://localhost/api/tip/attachment', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-libsodium-sealed-box',
        'x-forwarded-for': '10.0.0.100',
      },
      body: new Uint8Array(0),
    });
    const res = await attachmentPost(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('empty-body');
  });
});

describe('tier-1 audit — Content-Length parsing strictness', () => {
  // Pre-fix: `Number('abc')` evaluates to NaN; `NaN > 256*1024` is false.
  // A request with a non-numeric Content-Length silently bypassed the
  // size cap. These tests pin the strict /^\d+$/ pre-check on both
  // tip-submit and tip-attachment.

  it('tip-submit rejects non-numeric Content-Length with 400', async () => {
    const req = new NextRequest('http://localhost/api/tip/submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': 'abc-not-a-number',
      },
      body: '{}',
    });
    const res = await submitPost(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('invalid-content-length');
  });

  it('tip-submit rejects Content-Length with a sign character', async () => {
    // "-1" trivially passes Number(...) > N (= -1 > N is false) but also
    // signals a malformed client. The strict /^\d+$/ test rejects it.
    const req = new NextRequest('http://localhost/api/tip/submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '-1',
      },
      body: '{}',
    });
    const res = await submitPost(req);
    expect(res.status).toBe(400);
  });

  it('tip-attachment rejects non-numeric Content-Length with 400 (pre-check)', async () => {
    const req = new NextRequest('http://localhost/api/tip/attachment', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-libsodium-sealed-box',
        'content-length': 'nine-hundred',
        'x-forwarded-for': '10.0.0.101',
      },
      body: new Uint8Array(64),
    });
    const res = await attachmentPost(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('invalid-content-length');
  });

  it('tip-attachment rejects oversized Content-Length BEFORE buffering the body', async () => {
    // Claim 50 MB via header. The pre-check should 413 immediately,
    // without first reading the body. We provide a small body (the
    // mismatch is acceptable — the route trusts the header for the
    // gate, then re-validates after reading).
    const req = new NextRequest('http://localhost/api/tip/attachment', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-libsodium-sealed-box',
        'content-length': String(50 * 1024 * 1024),
        'x-forwarded-for': '10.0.0.102',
      },
      body: new Uint8Array(64),
    });
    const res = await attachmentPost(req);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('too-large');
  });
});
