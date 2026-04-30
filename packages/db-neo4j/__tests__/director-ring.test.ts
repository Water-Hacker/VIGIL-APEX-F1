/**
 * Director-ring detector — bipartite-overlap tests against stubbed Neo4j.
 */
import { describe, expect, it } from 'vitest';

import { detectDirectorRings } from '../src/gds/director-ring.js';

import type { Neo4jClient } from '../src/client.js';

interface StubResponses {
  directorships?: ReadonlyArray<{ person: string; company: string }>;
  bidders?: ReadonlyArray<{ tender: string; company: string }>;
}

function stubClient(r: StubResponses): Neo4jClient {
  return {
    async run<T>(query: string): Promise<T[]> {
      if (query.includes('IS_DIRECTOR_OF')) return (r.directorships ?? []) as unknown as T[];
      if (query.includes('BID_FOR')) return (r.bidders ?? []) as unknown as T[];
      return [];
    },
    close: async () => undefined,
  } as unknown as Neo4jClient;
}

describe('detectDirectorRings', () => {
  it('flags a person who directs 2 of 3 bidders for the same tender', async () => {
    const r = await detectDirectorRings(
      stubClient({
        directorships: [
          { person: 'p-1', company: 'co-a' },
          { person: 'p-1', company: 'co-b' },
          { person: 'p-2', company: 'co-c' },
        ],
        bidders: [
          { tender: 't-1', company: 'co-a' },
          { tender: 't-1', company: 'co-b' },
          { tender: 't-1', company: 'co-c' },
        ],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.personId).toBe('p-1');
    expect(r[0]?.sharedTenderIds).toEqual(['t-1']);
    expect(r[0]?.companyIds.sort()).toEqual(['co-a', 'co-b']);
  });

  it('does NOT flag a person with only 1 directorship in the bidder set', async () => {
    const r = await detectDirectorRings(
      stubClient({
        directorships: [
          { person: 'p-1', company: 'co-a' },
          { person: 'p-1', company: 'co-z' }, // not in tender
        ],
        bidders: [
          { tender: 't-1', company: 'co-a' },
          { tender: 't-1', company: 'co-b' },
        ],
      }),
    );
    expect(r).toEqual([]);
  });

  it('aggregates tenders for a recurring ring member', async () => {
    const r = await detectDirectorRings(
      stubClient({
        directorships: [
          { person: 'p-1', company: 'co-a' },
          { person: 'p-1', company: 'co-b' },
        ],
        bidders: [
          { tender: 't-1', company: 'co-a' },
          { tender: 't-1', company: 'co-b' },
          { tender: 't-2', company: 'co-a' },
          { tender: 't-2', company: 'co-b' },
        ],
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.sharedTenderIds.sort()).toEqual(['t-1', 't-2']);
  });
});
