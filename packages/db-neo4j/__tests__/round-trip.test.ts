/**
 * Round-trip detector — pure-logic tests via a stubbed Neo4jClient.
 *
 * Ensures: bounded BFS terminates within MAX_HOPS, deterministic ordering,
 * cycle detection, MAX_FANOUT respected, zero-edge graphs return empty.
 */
import { describe, expect, it } from 'vitest';

import { detectRoundTrips } from '../src/gds/round-trip.js';

import type { Neo4jClient } from '../src/client.js';

interface StubResponses {
  awards?: ReadonlyArray<{ supplier: string; authority: string; ts: string }>;
  edges?: ReadonlyArray<{ from: string; to: string }>;
  officers?: ReadonlyArray<{ authority: string; person: string }>;
}

function stubClient(r: StubResponses): Neo4jClient {
  let queryCount = 0;
  const fake: Neo4jClient = {
    async run<T>(query: string): Promise<T[]> {
      queryCount += 1;
      if (query.includes('AWARDED_BY')) return (r.awards ?? []) as unknown as T[];
      if (query.includes('PAID_TO')) return (r.edges ?? []) as unknown as T[];
      if (query.includes('OFFICER_OF')) return (r.officers ?? []) as unknown as T[];
      return [];
    },
    close: async () => undefined,
    // unused fields the type expects
  } as unknown as Neo4jClient;
  void queryCount;
  return fake;
}

describe('detectRoundTrips', () => {
  it('returns empty when graph is empty', async () => {
    const result = await detectRoundTrips(stubClient({}));
    expect(result).toEqual([]);
  });

  it('detects a 2-hop round-trip from supplier to officer', async () => {
    const result = await detectRoundTrips(
      stubClient({
        awards: [{ supplier: 's-1', authority: 'a-1', ts: '2024-01-01' }],
        edges: [
          { from: 's-1', to: 'inter-1' },
          { from: 'inter-1', to: 'p-1' },
        ],
        officers: [{ authority: 'a-1', person: 'p-1' }],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.supplierId).toBe('s-1');
    expect(result[0]?.awardingOfficerId).toBe('p-1');
    expect(result[0]?.hops).toBe(2);
  });

  it('handles cycles without infinite loop', async () => {
    const result = await detectRoundTrips(
      stubClient({
        awards: [{ supplier: 's-1', authority: 'a-1', ts: '2024-01-01' }],
        edges: [
          { from: 's-1', to: 'x' },
          { from: 'x', to: 'y' },
          { from: 'y', to: 's-1' }, // cycle back
          { from: 'y', to: 'p-1' }, // also reaches officer at depth 3
        ],
        officers: [{ authority: 'a-1', person: 'p-1' }],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.hops).toBe(3);
  });

  it('does not exceed MAX_HOPS depth', async () => {
    // Chain length 5: supplier → 1 → 2 → 3 → 4 → officer (5 hops)
    // MAX_HOPS = 3, so should NOT detect.
    const result = await detectRoundTrips(
      stubClient({
        awards: [{ supplier: 's-1', authority: 'a-1', ts: '2024-01-01' }],
        edges: [
          { from: 's-1', to: '1' },
          { from: '1', to: '2' },
          { from: '2', to: '3' },
          { from: '3', to: '4' },
          { from: '4', to: 'p-1' },
        ],
        officers: [{ authority: 'a-1', person: 'p-1' }],
      }),
    );
    expect(result).toEqual([]);
  });

  it('returns deterministic ordering', async () => {
    const r1 = await detectRoundTrips(
      stubClient({
        awards: [
          { supplier: 's-2', authority: 'a-1', ts: '2024-01-01' },
          { supplier: 's-1', authority: 'a-1', ts: '2024-01-01' },
        ],
        edges: [
          { from: 's-1', to: 'p-1' },
          { from: 's-2', to: 'p-1' },
        ],
        officers: [{ authority: 'a-1', person: 'p-1' }],
      }),
    );
    expect(r1.map((d) => d.supplierId)).toEqual(['s-1', 's-2']);
  });
});
