/**
 * DECISION-012 — public-route redaction contract.
 *
 * `GET /api/audit/public` is the unauthenticated REST endpoint. The
 * contract:
 *   - Category B/C events MUST have target_resource = `[REDACTED:CATEGORY-X]`
 *   - Category I events MUST have target_resource = '[PUBLIC]'
 *   - actor_id is dropped from the response
 *   - Response sets `Cache-Control: public, max-age=60`
 *   - `limit` query param is clamped to ≤ 500
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vigil/db-postgres', async () => {
  const sample = [
    {
      event_id: '11111111-1111-1111-1111-111111111111',
      event_type: 'auth.login_succeeded',
      category: 'A',
      timestamp_utc: new Date('2026-04-29T12:00:00Z'),
      actor_id: 'user:alice',
      actor_role: 'operator',
      target_resource: '/auth/login',
      result_status: 'success',
      chain_anchor_tx: null,
      high_significance: false,
      prior_event_id: null,
      record_hash: 'rh1',
    },
    {
      event_id: '22222222-2222-2222-2222-222222222222',
      event_type: 'search.entity',
      category: 'B',
      timestamp_utc: new Date('2026-04-29T12:01:00Z'),
      actor_id: 'user:bob',
      actor_role: 'analyst',
      target_resource: '/search?q=Sensitive+Person',
      result_status: 'success',
      chain_anchor_tx: null,
      high_significance: false,
      prior_event_id: null,
      record_hash: 'rh2',
    },
    {
      event_id: '33333333-3333-3333-3333-333333333333',
      event_type: 'dossier.opened',
      category: 'C',
      timestamp_utc: new Date('2026-04-29T12:02:00Z'),
      actor_id: 'user:carol',
      actor_role: 'auditor',
      target_resource: '/documents/very-secret-file.pdf',
      result_status: 'success',
      chain_anchor_tx: '0x' + 'a'.repeat(64),
      high_significance: true,
      prior_event_id: null,
      record_hash: 'rh3',
    },
    {
      event_id: '44444444-4444-4444-4444-444444444444',
      event_type: 'public.tip_submitted',
      category: 'I',
      timestamp_utc: new Date('2026-04-29T12:03:00Z'),
      actor_id: 'public:anonymous',
      actor_role: 'public',
      target_resource: 'tip-id:abc123',
      result_status: 'success',
      chain_anchor_tx: null,
      high_significance: false,
      prior_event_id: null,
      record_hash: 'rh4',
    },
  ];

  let lastListPublicArgs: { limit?: number; category?: string } | null = null;

  class FakeRepo {
    async listPublic(opts: { limit?: number; category?: string }) {
      lastListPublicArgs = opts;
      const filtered = opts.category ? sample.filter((s) => s.category === opts.category) : sample;
      return filtered;
    }
  }

  return {
    UserActionEventRepo: FakeRepo,
    getDb: async () => ({}),
    __getLastArgs: () => lastListPublicArgs,
  };
});

import { GET } from '../src/app/api/audit/public/route.js';
import * as dbMock from '@vigil/db-postgres';

function makeReq(url: string) {
  // The route uses `req.nextUrl.searchParams`; the Node-side NextRequest
  // shim from 'next/server' would require a heavier setup. We construct
  // the minimum surface the route actually touches.
  const u = new URL(url);
  return {
    nextUrl: u,
  } as unknown as Parameters<typeof GET>[0];
}

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  // no-op — module-level mock is hoisted
});

describe('GET /api/audit/public — redaction contract', () => {
  it('redacts category B and C target_resource and drops actor_id', async () => {
    const res = await GET(makeReq('http://localhost/api/audit/public?limit=100'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');

    const body = (await res.json()) as { count: number; events: Array<Record<string, unknown>> };
    expect(body.count).toBe(4);

    const byCat = Object.fromEntries(body.events.map((e) => [e.category, e]));
    expect(byCat.A!.target_resource).toBe('/auth/login');
    expect(byCat.B!.target_resource).toBe('[REDACTED:CATEGORY-B]');
    expect(byCat.C!.target_resource).toBe('[REDACTED:CATEGORY-C]');
    expect(byCat.I!.target_resource).toBe('[PUBLIC]');

    // No actor_id in any event payload
    for (const ev of body.events) {
      expect(ev).not.toHaveProperty('actor_id');
      expect(ev).not.toHaveProperty('actor_ip');
      expect(ev).not.toHaveProperty('actor_yubikey_serial');
      expect(ev).not.toHaveProperty('record_hash');
      expect(ev).not.toHaveProperty('prior_event_id');
      expect(ev).toHaveProperty('actor_role');
      expect(ev).toHaveProperty('actor_authenticated');
    }
  });

  it('clamps limit to 500 and respects category filter', async () => {
    await GET(makeReq('http://localhost/api/audit/public?limit=600&category=B'));
    const args = (dbMock as unknown as { __getLastArgs: () => { limit?: number; category?: string } }).__getLastArgs();
    expect(args!.limit).toBe(500);
    expect(args!.category).toBe('B');
  });

  it('rejects invalid since/until with 400', async () => {
    const res = await GET(makeReq('http://localhost/api/audit/public?since=not-a-date'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid-time-bounds');
  });

  it('drops invalid category param silently (treats as undefined)', async () => {
    const res = await GET(makeReq('http://localhost/api/audit/public?category=Z'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { category?: string };
    expect(body.category).toBeUndefined();
  });
});
