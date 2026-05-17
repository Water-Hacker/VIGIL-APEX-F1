/**
 * Tier-55 audit closure — proxy-header trust gate tests.
 *
 * Verifies that `getTrustedClientIp`:
 *   (a) Returns the cf-connecting-ip / x-forwarded-for value ONLY
 *       when TRUST_PROXY_HEADERS=true OR NODE_ENV=production.
 *   (b) Returns null in dev/test (default) — so the per-route
 *       rate-limit falls into a single anonymous bucket and an
 *       adversary cannot rotate spoofed headers to bypass the limit.
 *   (c) Honours an explicit TRUST_PROXY_HEADERS=false override even
 *       in production builds.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTrustedClientIp } from '../src/lib/trusted-client-ip.js';

function fakeReq(headers: Record<string, string> = {}): unknown {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { headers: { get: (k: string) => lower[k.toLowerCase()] ?? null } };
}

describe('Tier-55 — getTrustedClientIp gating', () => {
  const ORIGINAL = {
    trust: process.env.TRUST_PROXY_HEADERS,
    nodeEnv: process.env.NODE_ENV,
  };
  beforeEach(() => {
    delete process.env.TRUST_PROXY_HEADERS;
    delete (process.env as { NODE_ENV?: string }).NODE_ENV;
  });
  afterEach(() => {
    if (ORIGINAL.trust !== undefined) process.env.TRUST_PROXY_HEADERS = ORIGINAL.trust;
    else delete process.env.TRUST_PROXY_HEADERS;
    if (ORIGINAL.nodeEnv !== undefined)
      (process.env as { NODE_ENV?: string }).NODE_ENV = ORIGINAL.nodeEnv;
    else delete (process.env as { NODE_ENV?: string }).NODE_ENV;
  });

  it('returns null in dev (no env, no header) — single anonymous bucket', () => {
    const r = fakeReq({ 'cf-connecting-ip': '203.0.113.42' });
    expect(getTrustedClientIp(r as never)).toBeNull();
  });

  it('returns the IP when TRUST_PROXY_HEADERS=true (explicit production-proxy)', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';
    const r = fakeReq({ 'cf-connecting-ip': '203.0.113.42' });
    expect(getTrustedClientIp(r as never)).toBe('203.0.113.42');
  });

  it('returns the IP when NODE_ENV=production (default trust)', () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
    const r = fakeReq({ 'cf-connecting-ip': '203.0.113.42' });
    expect(getTrustedClientIp(r as never)).toBe('203.0.113.42');
  });

  it('TRUST_PROXY_HEADERS=false overrides NODE_ENV=production', () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
    process.env.TRUST_PROXY_HEADERS = 'false';
    const r = fakeReq({ 'cf-connecting-ip': '203.0.113.42' });
    expect(getTrustedClientIp(r as never)).toBeNull();
  });

  it('falls back to x-forwarded-for first-entry when cf-connecting-ip absent', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';
    const r = fakeReq({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1, 10.0.0.2' });
    expect(getTrustedClientIp(r as never)).toBe('198.51.100.1');
  });

  it('returns null when trusted but no headers present', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';
    expect(getTrustedClientIp(fakeReq() as never)).toBeNull();
  });

  it('cf-connecting-ip takes precedence over x-forwarded-for', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';
    const r = fakeReq({
      'cf-connecting-ip': '203.0.113.99',
      'x-forwarded-for': '198.51.100.1',
    });
    expect(getTrustedClientIp(r as never)).toBe('203.0.113.99');
  });
});
