/**
 * Bidder-density tests — pairwise relation count vs. (n choose 2) total.
 */
import { describe, expect, it } from 'vitest';

import { computeBidderDensity } from '../src/gds/bidder-density.js';

import type { Neo4jClient } from '../src/client.js';

interface StubResponses {
  bidders?: ReadonlyArray<{ tender: string; bidder: string }>;
  relations?: ReadonlyArray<{ a: string; b: string }>;
}

function stubClient(r: StubResponses): Neo4jClient {
  return {
    async run<T>(query: string): Promise<T[]> {
      if (query.includes('BID_FOR')) return (r.bidders ?? []) as unknown as T[];
      if (query.includes('RELATED_TO')) return (r.relations ?? []) as unknown as T[];
      return [];
    },
    close: async () => undefined,
  } as unknown as Neo4jClient;
}

describe('computeBidderDensity', () => {
  it('returns 1.0 when all bidder pairs are related', async () => {
    const r = await computeBidderDensity(
      stubClient({
        bidders: [
          { tender: 't-1', bidder: 'a' },
          { tender: 't-1', bidder: 'b' },
          { tender: 't-1', bidder: 'c' },
        ],
        relations: [
          { a: 'a', b: 'b' },
          { a: 'a', b: 'c' },
          { a: 'b', b: 'c' },
        ],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.density).toBe(1);
  });

  it('returns 0 when no bidder pairs are related', async () => {
    const r = await computeBidderDensity(
      stubClient({
        bidders: [
          { tender: 't-1', bidder: 'a' },
          { tender: 't-1', bidder: 'b' },
        ],
        relations: [],
      }),
    );
    expect(r[0]?.density).toBe(0);
  });

  it('handles mid-density correctly (1 of 3 pairs related)', async () => {
    const r = await computeBidderDensity(
      stubClient({
        bidders: [
          { tender: 't-1', bidder: 'a' },
          { tender: 't-1', bidder: 'b' },
          { tender: 't-1', bidder: 'c' },
        ],
        relations: [{ a: 'a', b: 'b' }],
      }),
    );
    expect(r[0]?.density).toBeCloseTo(1 / 3, 4);
  });

  it('skips tenders with < 2 bidders', async () => {
    const r = await computeBidderDensity(
      stubClient({
        bidders: [{ tender: 't-1', bidder: 'a' }],
      }),
    );
    expect(r).toEqual([]);
  });
});
