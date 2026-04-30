/**
 * Supplier-circular-flow detector tests — directed-cycle detection
 * with bounded depth + visited-set termination.
 */
import { describe, expect, it } from 'vitest';

import { detectSupplierCycles } from '../src/gds/supplier-cycles.js';

import type { Neo4jClient } from '../src/client.js';

interface Stub {
  edges?: ReadonlyArray<{ from: string; to: string }>;
}

function stubClient(s: Stub): Neo4jClient {
  return {
    async run<T>(query: string): Promise<T[]> {
      if (query.includes('PAID_TO')) return (s.edges ?? []) as unknown as T[];
      return [];
    },
    close: async () => undefined,
  } as unknown as Neo4jClient;
}

describe('detectSupplierCycles', () => {
  it('detects a 3-node A→B→C→A cycle (one detection per start node)', async () => {
    const r = await detectSupplierCycles(
      stubClient({
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
          { from: 'C', to: 'A' },
        ],
      }),
    );
    // Each company is detected as a starting point of the same cycle.
    expect(r.length).toBe(3);
    for (const det of r) expect(det.cycleLength).toBe(3);
    const a = r.find((d) => d.companyId === 'A');
    expect(a?.cycleMembers).toEqual(['A', 'B', 'C']);
  });

  it('rejects 2-node A→B→A self-loop (too short for procurement-cycle semantics)', async () => {
    const r = await detectSupplierCycles(
      stubClient({
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'A' },
        ],
      }),
    );
    expect(r).toEqual([]);
  });

  it('returns empty when there is no cycle', async () => {
    const r = await detectSupplierCycles(
      stubClient({
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
        ],
      }),
    );
    expect(r).toEqual([]);
  });

  it('detects the SHORTEST cycle, not a longer one through the same node', async () => {
    // A→B→C→A is length 3; A→B→C→D→A would be length 4. The shortest wins.
    const r = await detectSupplierCycles(
      stubClient({
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
          { from: 'C', to: 'A' },
          { from: 'C', to: 'D' },
          { from: 'D', to: 'A' },
        ],
      }),
    );
    const a = r.find((d) => d.companyId === 'A');
    expect(a?.cycleLength).toBe(3);
  });

  it('respects MAX_CYCLE_LEN', async () => {
    // Build a 7-node chain that loops; should NOT detect (default MAX=6).
    const r = await detectSupplierCycles(
      stubClient({
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
          { from: 'C', to: 'D' },
          { from: 'D', to: 'E' },
          { from: 'E', to: 'F' },
          { from: 'F', to: 'G' },
          { from: 'G', to: 'A' }, // 7-node cycle
        ],
      }),
      { maxLength: 6 },
    );
    expect(r).toEqual([]);
  });

  it('returns deterministic ordering by companyId', async () => {
    const r = await detectSupplierCycles(
      stubClient({
        edges: [
          { from: 'C', to: 'B' },
          { from: 'B', to: 'A' },
          { from: 'A', to: 'C' },
        ],
      }),
    );
    expect(r.map((d) => d.companyId)).toEqual(['A', 'B', 'C']);
  });
});
