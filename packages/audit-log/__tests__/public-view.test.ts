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
    expect(toPublicView(row({ category: 'D', target_resource: 'proposal:42' })).target_resource).toBe(
      'proposal:42',
    );
    expect(toPublicView(row({ category: 'E', target_resource: 'finding:abc' })).target_resource).toBe(
      'finding:abc',
    );
    expect(toPublicView(row({ category: 'F', target_resource: 'prompt:v2.0.0' })).target_resource).toBe(
      'prompt:v2.0.0',
    );
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
    expect(hashPii('Mr X')).toEqual(hashPii('Mr X'));
  });
  it('rotates with the salt', () => {
    expect(hashPii('Mr X', 'salt-a')).not.toEqual(hashPii('Mr X', 'salt-b'));
  });
  it('returns 16 hex chars', () => {
    expect(hashPii('any').length).toBe(16);
  });
});
