/**
 * Tier-43 audit closure — bounded-work caps on cycle DFS + per-cycle
 * candidate emission.
 *
 * Two DoS surfaces existed before the fix:
 *
 *   (1) `detectCycles` runs DFS from every source node with no upper
 *       bound on recursive expansion or result count. On a dense
 *       subgraph (the snapshot loader caps edges at 200_000) a high
 *       fan-out hub trivially produces exponential candidate paths
 *       before the sorted-path-key dedup kicks in (dedup happens at
 *       cycle-FOUND time, not during expansion). A pathological
 *       state-payment hub — the exact shape we WANT to flag —
 *       could pin the worker indefinitely.
 *
 *   (2) `runDiscoveryCycle` upserts every returned candidate AND
 *       appends one row to the HashChain per candidate. The chain
 *       is serial-by-construction. Any pathological detect pass
 *       (e.g., 50k entities all stellar-degree in a metric-explosion
 *       scenario) floods the audit chain in a single cycle.
 *
 * Fixes: MAX_CYCLE_DFS_STEPS + MAX_CYCLE_CANDIDATES inside
 * `detectCycles` (per-invocation budget, fail-soft with `_dfs_capped`
 * evidence marker on the last result), and MAX_CANDIDATES_PER_CYCLE
 * outer slice in `runDiscoveryCycle` (drops surplus with a structured
 * warn log so the operator can route the snapshot to partitioned
 * discovery).
 *
 * Tests below exercise both caps with smaller fixture-friendly limits
 * imported from the module's exported constants. We do NOT mutate
 * the constants — instead the dense-graph fixture is small enough
 * to fit within the production cap while still demonstrating the
 * cap behaviour via test-only synthetic candidates.
 */
import { describe, expect, it, vi } from 'vitest';

import { runDiscoveryCycle, type DiscoveryCycleContext } from '../src/discovery-loop.js';
import {
  MAX_CANDIDATES_PER_CYCLE,
  detectCycles,
  type GraphSnapshot,
} from '../src/graph-anomalies.js';

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child(): typeof silentLogger {
    return silentLogger;
  },
} as unknown as DiscoveryCycleContext['logger'];

describe('Tier-43 — detectCycles bounded DFS', () => {
  it('terminates in bounded time on a fully-connected graph that would otherwise explode', () => {
    // A 12-node complete digraph: every node points to every other.
    // Number of simple cycles of length <= 6 in K_12: > 100 million.
    // Pre-fix: this hung the worker. Post-fix: it returns under the
    // candidate cap with `_dfs_capped` evidence on the last result.
    const N = 12;
    const nodes = Array.from({ length: N }, (_, i) => ({
      id: `n-${i}`,
      kind: 'Company' as const,
      degree: N - 1,
    }));
    const edges = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        edges.push({
          from_id: `n-${i}`,
          to_id: `n-${j}`,
          amount_xaf: 1,
          date: '2026-01-01',
          is_state_origin: false,
        });
      }
    }
    const snap: GraphSnapshot = { nodes, edges };

    const t0 = Date.now();
    const out = detectCycles(snap);
    const elapsedMs = Date.now() - t0;

    // Wall-clock bound: pre-fix this hung indefinitely. 5 s is a
    // generous CI ceiling; in practice the dense-graph DFS finishes
    // well under 1 s with the budget caps in place.
    expect(elapsedMs).toBeLessThan(5_000);

    // We must have found SOME cycles (the graph is rich in them).
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns a finite (capped) candidate set rather than exhausting memory', () => {
    // Same dense-graph fixture as above; assert that the result count
    // is at least loosely bounded — the cap is generous (5_000 in
    // production) so we just assert "much less than the theoretical
    // upper bound of ~100M possible cycle paths".
    const N = 12;
    const nodes = Array.from({ length: N }, (_, i) => ({
      id: `n-${i}`,
      kind: 'Company' as const,
      degree: N - 1,
    }));
    const edges = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        edges.push({
          from_id: `n-${i}`,
          to_id: `n-${j}`,
          amount_xaf: 1,
          date: '2026-01-01',
          is_state_origin: false,
        });
      }
    }
    const snap: GraphSnapshot = { nodes, edges };

    const out = detectCycles(snap);
    // 5000 is the MAX_CYCLE_CANDIDATES production cap.
    expect(out.length).toBeLessThanOrEqual(5_000);
  });

  it('returns clean results without capping on a small acyclic+cyclic mixed graph', () => {
    const snap: GraphSnapshot = {
      nodes: [
        { id: 'a', kind: 'Company', degree: 2 },
        { id: 'b', kind: 'Company', degree: 2 },
        { id: 'c', kind: 'Company', degree: 2 },
        { id: 'd', kind: 'Company', degree: 1 },
      ],
      edges: [
        { from_id: 'a', to_id: 'b', amount_xaf: 1, date: '2026-01-01', is_state_origin: false },
        { from_id: 'b', to_id: 'c', amount_xaf: 1, date: '2026-01-02', is_state_origin: false },
        { from_id: 'c', to_id: 'a', amount_xaf: 1, date: '2026-01-03', is_state_origin: false },
        { from_id: 'a', to_id: 'd', amount_xaf: 1, date: '2026-01-04', is_state_origin: false },
      ],
    };
    const out = detectCycles(snap);
    // Exactly one cycle (a→b→c→a), no cap-hit marker.
    expect(out).toHaveLength(1);
    expect(out[0]!.evidence._dfs_capped).toBeUndefined();
  });
});

describe('Tier-43 — runDiscoveryCycle per-cycle candidate cap', () => {
  it('caps work at MAX_CANDIDATES_PER_CYCLE and logs the drop', async () => {
    // Build a snapshot guaranteed to fire stellar_degree on every
    // node — we'll synthesise > MAX_CANDIDATES_PER_CYCLE + 50 such
    // nodes so the cap is exercised.
    const total = MAX_CANDIDATES_PER_CYCLE + 50;
    const nodes = Array.from({ length: total }, (_, i) => ({
      id: `hub-${i}`,
      kind: 'Company' as const,
      degree: 200, // > STELLAR_DEGREE_P99 (50)
    }));
    const snapshot: GraphSnapshot = { nodes, edges: [] };

    const repo = {
      upsertCandidate: vi.fn().mockResolvedValue({ inserted: true }),
    };
    const chain = { append: vi.fn().mockResolvedValue(undefined) };
    const warn = vi.fn();
    const info = vi.fn();
    const logger = {
      ...silentLogger,
      warn,
      info,
    } as unknown as DiscoveryCycleContext['logger'];

    const result = await runDiscoveryCycle({
      repo: repo as never,
      chain: chain as never,
      logger,
      loadSnapshot: async () => snapshot,
    });

    expect(result.anomalies_detected).toBe(MAX_CANDIDATES_PER_CYCLE);
    expect(repo.upsertCandidate).toHaveBeenCalledTimes(MAX_CANDIDATES_PER_CYCLE);
    expect(chain.append).toHaveBeenCalledTimes(MAX_CANDIDATES_PER_CYCLE);

    // Cap-hit must be logged as a structured warn the operator can
    // route on; the message conveys the dropped count.
    const capWarn = warn.mock.calls.find(
      (call) => call[1] === 'pattern-discovery-cycle-candidate-cap-hit',
    );
    expect(capWarn).toBeDefined();
    expect(capWarn![0]).toMatchObject({
      total_detected: total,
      cap: MAX_CANDIDATES_PER_CYCLE,
      dropped: 50,
    });
  });

  it('does NOT log the cap-hit warn on a normal-sized cycle', async () => {
    // A handful of stellar nodes — well under the cap.
    const snapshot: GraphSnapshot = {
      nodes: Array.from({ length: 5 }, (_, i) => ({
        id: `hub-${i}`,
        kind: 'Company' as const,
        degree: 200,
      })),
      edges: [],
    };
    const repo = {
      upsertCandidate: vi.fn().mockResolvedValue({ inserted: true }),
    };
    const chain = { append: vi.fn().mockResolvedValue(undefined) };
    const warn = vi.fn();
    const logger = {
      ...silentLogger,
      warn,
    } as unknown as DiscoveryCycleContext['logger'];

    await runDiscoveryCycle({
      repo: repo as never,
      chain: chain as never,
      logger,
      loadSnapshot: async () => snapshot,
    });
    const capWarn = warn.mock.calls.find(
      (call) => call[1] === 'pattern-discovery-cycle-candidate-cap-hit',
    );
    expect(capWarn).toBeUndefined();
  });
});
