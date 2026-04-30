/**
 * Hub-and-spoke metric tests — per-supplier authority concentration.
 */
import { describe, expect, it } from 'vitest';

import { computeHubAndSpoke, HUB_SPOKE_MIN_CONTRACTS } from '../src/gds/hub-and-spoke.js';

import type { Neo4jClient } from '../src/client.js';

interface Stub {
  awards?: ReadonlyArray<{ supplier: string; authority: string }>;
}

function stubClient(s: Stub): Neo4jClient {
  return {
    async run<T>(query: string): Promise<T[]> {
      if (query.includes('AWARDED_BY')) return (s.awards ?? []) as unknown as T[];
      return [];
    },
    close: async () => undefined,
  } as unknown as Neo4jClient;
}

describe('computeHubAndSpoke', () => {
  it('flags a supplier with 100% concentration on one authority', async () => {
    const r = await computeHubAndSpoke(
      stubClient({
        awards: [
          { supplier: 's-1', authority: 'a-1' },
          { supplier: 's-1', authority: 'a-1' },
          { supplier: 's-1', authority: 'a-1' },
        ],
      }),
    );
    expect(r.length).toBe(1);
    expect(r[0]?.authorityConcentrationRatio).toBe(1);
    expect(r[0]?.publicContractsCount).toBe(3);
    expect(r[0]?.distinctAuthorities).toBe(1);
    expect(r[0]?.hubAuthorityId).toBe('a-1');
  });

  it('computes mid-concentration correctly', async () => {
    const r = await computeHubAndSpoke(
      stubClient({
        awards: [
          { supplier: 's-1', authority: 'a-1' },
          { supplier: 's-1', authority: 'a-1' },
          { supplier: 's-1', authority: 'a-1' },
          { supplier: 's-1', authority: 'a-2' },
        ],
      }),
    );
    expect(r[0]?.authorityConcentrationRatio).toBe(0.75);
    expect(r[0]?.distinctAuthorities).toBe(2);
  });

  it('skips suppliers below MIN_CONTRACTS', async () => {
    const r = await computeHubAndSpoke(
      stubClient({
        awards: [
          { supplier: 's-1', authority: 'a-1' },
          { supplier: 's-1', authority: 'a-1' },
        ],
      }),
    );
    expect(r).toEqual([]);
    expect(HUB_SPOKE_MIN_CONTRACTS).toBe(3);
  });

  it('handles multiple suppliers independently', async () => {
    const r = await computeHubAndSpoke(
      stubClient({
        awards: [
          { supplier: 's-1', authority: 'a-1' },
          { supplier: 's-1', authority: 'a-1' },
          { supplier: 's-1', authority: 'a-2' },
          { supplier: 's-2', authority: 'a-3' },
          { supplier: 's-2', authority: 'a-3' },
          { supplier: 's-2', authority: 'a-3' },
        ],
      }),
    );
    // Both suppliers reach MIN_CONTRACTS=3
    expect(r.length).toBe(2);
    const s1 = r.find((m) => m.supplierId === 's-1');
    expect(s1?.authorityConcentrationRatio).toBeCloseTo(2 / 3, 5);
    const s2 = r.find((m) => m.supplierId === 's-2');
    expect(s2?.authorityConcentrationRatio).toBe(1);
  });

  it('returns deterministic ordering', async () => {
    const r = await computeHubAndSpoke(
      stubClient({
        awards: [
          { supplier: 's-2', authority: 'a-1' },
          { supplier: 's-2', authority: 'a-1' },
          { supplier: 's-2', authority: 'a-1' },
          { supplier: 's-1', authority: 'a-1' },
          { supplier: 's-1', authority: 'a-1' },
          { supplier: 's-1', authority: 'a-1' },
        ],
      }),
    );
    expect(r.map((m) => m.supplierId)).toEqual(['s-1', 's-2']);
  });
});
