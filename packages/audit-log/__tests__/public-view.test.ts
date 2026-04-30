import { describe, expect, it } from 'vitest';

import { hashPii, toPublicView, type PublicViewRow } from '../src/public-view.js';

const row = (over: Partial<PublicViewRow> = {}): PublicViewRow => ({
  event_id: '00000000-0000-0000-0000-000000000001',
  event_type: 'search.entity',
  category: 'B',
  timestamp_utc: '2026-04-29T00:00:00.000Z',
  actor_id: 'user-1',
  actor_role: 'operator',
  target_resource: 'q=Mr Confidential Suspect',
  result_status: 'success',
  chain_anchor_tx: null,
  high_significance: false,
  ...over,
});

describe('toPublicView', () => {
  it('drops actor_id and exposes only role + auth flag', () => {
    const v = toPublicView(row());
    expect((v as unknown as Record<string, unknown>).actor_id).toBeUndefined();
    expect(v.actor_role).toBe('operator');
    expect(v.actor_authenticated).toBe(true);
  });

  it('redacts target_resource for category B (search/query) to protect PII', () => {
    const v = toPublicView(row({ category: 'B', target_resource: 'PII-Y-NAME' }));
    expect(v.target_resource).toBe('[REDACTED:CATEGORY-B]');
  });

  it('redacts target_resource for category C (dossier access)', () => {
    const v = toPublicView(row({ category: 'C', target_resource: 'VA-2026-0001' }));
    expect(v.target_resource).toBe('[REDACTED:CATEGORY-C]');
  });

  it('preserves target_resource for D / E / F categories (decisions, modifications, config)', () => {
    expect(
      toPublicView(row({ category: 'D', target_resource: 'proposal:42' })).target_resource,
    ).toBe('proposal:42');
    expect(
      toPublicView(row({ category: 'E', target_resource: 'finding:abc' })).target_resource,
    ).toBe('finding:abc');
    expect(
      toPublicView(row({ category: 'F', target_resource: 'prompt:v2.0.0' })).target_resource,
    ).toBe('prompt:v2.0.0');
  });

  it('marks public-portal events as [PUBLIC] without leaking submitter identity', () => {
    const v = toPublicView(
      row({
        category: 'I',
        actor_id: 'public:anon',
        actor_role: 'public',
        target_resource: 'tip:secret-id',
      }),
    );
    expect(v.target_resource).toBe('[PUBLIC]');
    expect(v.actor_authenticated).toBe(false);
  });

  it('marks system: actors as not authenticated', () => {
    const v = toPublicView(row({ actor_id: 'system:worker-score', actor_role: 'system' }));
    expect(v.actor_authenticated).toBe(false);
  });
});

describe('hashPii', () => {
  it('is deterministic for the same input', () => {
    expect(hashPii('Mr X', 'test-salt')).toEqual(hashPii('Mr X', 'test-salt'));
  });
  it('rotates with the salt', () => {
    expect(hashPii('Mr X', 'salt-a')).not.toEqual(hashPii('Mr X', 'salt-b'));
  });
  it('returns 16 hex chars', () => {
    expect(hashPii('any', 'test-salt').length).toBe(16);
  });
});

describe('AUDIT-065 — toPublicView redaction is total (property test)', () => {
  // Generates 100 random rows whose actor_id, actor-IP-shaped fields,
  // and target_resource carry distinctive byte patterns; asserts that
  // no PII byte appears anywhere in the JSON-serialised output for
  // categories B / C / I where the redaction contract requires it.
  function rng(seed: number): () => number {
    let s = (seed * 0x9e3779b9) >>> 0;
    return () => {
      s = (Math.imul(s, 0x85ebca6b) ^ (s >>> 13)) >>> 0;
      s = (Math.imul(s, 0xc2b2ae35) ^ (s >>> 16)) >>> 0;
      return (s >>> 0) / 0xffffffff;
    };
  }
  function randomRow(r: () => number): PublicViewRow {
    const cats = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
    const category = cats[Math.floor(r() * cats.length)]!;
    const piiTag = `PII-${Math.floor(r() * 1e9).toString(36)}`;
    return {
      event_id: '11111111-1111-1111-1111-111111111111',
      event_type: 'auth.login_success',
      category,
      timestamp_utc: '2026-04-30T00:00:00.000Z',
      actor_id: `user:${piiTag}`,
      actor_role: 'operator',
      target_resource: `/path/${piiTag}/q=${piiTag}`,
      result_status: 'success',
      chain_anchor_tx: null,
      high_significance: false,
    };
  }

  it('cat B / C: PII never appears anywhere in toPublicView output (100 random rows)', () => {
    const r = rng(42);
    for (let i = 0; i < 100; i++) {
      const row = { ...randomRow(r), category: i % 2 === 0 ? 'B' : 'C' };
      const v = toPublicView(row);
      const json = JSON.stringify(v);
      const piiTag = row.actor_id.split(':')[1]!;
      expect(json).not.toContain(piiTag);
      expect(json).not.toContain(row.actor_id);
      expect(json).not.toContain(row.target_resource);
    }
  });

  it('cat I (public portal): submitter identity is dropped', () => {
    const r = rng(99);
    for (let i = 0; i < 100; i++) {
      const row = { ...randomRow(r), category: 'I' };
      const v = toPublicView(row);
      const json = JSON.stringify(v);
      // actor_id is dropped (toPublicView drops it for every category).
      expect(json).not.toContain(row.actor_id);
      // target_resource is replaced with [PUBLIC].
      expect(json).not.toContain(row.target_resource);
      expect(v.target_resource).toBe('[PUBLIC]');
    }
  });

  it('cat A / D / E / F / G / H / J / K: target_resource is preserved (not redacted)', () => {
    const r = rng(7);
    for (const cat of ['A', 'D', 'E', 'F', 'G', 'H', 'J', 'K']) {
      const row = { ...randomRow(r), category: cat, target_resource: 'public-resource:42' };
      const v = toPublicView(row);
      expect(v.target_resource).toBe('public-resource:42');
      // actor_id still dropped on every category (TAL-PA contract).
      expect(JSON.stringify(v)).not.toContain(row.actor_id);
    }
  });
});

describe('AUDIT-031 — hashPii salt is required (no default)', () => {
  it('throws at runtime when called without a salt (forced via cast)', () => {
    expect(() => (hashPii as unknown as (v: string) => string)('Mr X')).toThrow(/salt/i);
  });

  it('throws when called with empty-string salt (would be a rainbow-tableable hash)', () => {
    expect(() => hashPii('Mr X', '')).toThrow(/salt/i);
  });

  it('throws when called with PLACEHOLDER salt', () => {
    expect(() => hashPii('Mr X', 'PLACEHOLDER')).toThrow(/PLACEHOLDER|salt/i);
  });

  it('accepts any non-empty non-PLACEHOLDER salt', () => {
    expect(hashPii('Mr X', 'real-salt-32-bytes-of-entropy-here')).toMatch(/^[0-9a-f]{16}$/);
  });
});
