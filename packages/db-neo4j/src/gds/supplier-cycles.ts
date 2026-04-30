/**
 * Supplier-circular-flow detector.
 *
 * Pattern P-F-003: A → B → C → A money cycle among supplier companies,
 * each leg invoiced as "service" or "consulting". Closed-loop money-
 * laundering vehicle.
 *
 * Implementation: bounded-depth DFS over PAID_TO edges starting and
 * ending at company nodes. For each company, search outgoing payment
 * edges up to MAX_CYCLE_LEN deep; if a directed path returns to the
 * start, record the cycle length.
 *
 * Hardening:
 *   - Bounded depth (MAX_CYCLE_LEN=6) — no exponential blow-up.
 *   - Bounded fan-out per node (MAX_FANOUT=200).
 *   - Visited-set per traversal — every node visited at most once.
 *   - Returns the SHORTEST cycle starting at each company (longer
 *     cycles are subsumed by their shorter sub-cycles).
 *   - Deterministic ordering (sort by companyId).
 */

import type { Neo4jClient } from '../client.js';

const MAX_CYCLE_LEN = 6;
const MAX_FANOUT = 200;

export interface SupplierCycleDetection {
  readonly companyId: string;
  /** Length of the shortest detected cycle starting at this company. */
  readonly cycleLength: number;
  /** Member ids in cycle order, starting at companyId. */
  readonly cycleMembers: ReadonlyArray<string>;
}

export interface SupplierCycleOptions {
  /** Cycle search depth cap. Default 6. */
  readonly maxLength?: number;
}

/**
 * Detect supplier-circular flows across the full graph.
 *
 * Returns one detection per company that participates in a cycle. The
 * `cycleLength` is the SHORTEST cycle starting at that company; longer
 * cycles for the same company are not reported (the shortest one
 * dominates the pattern's strength).
 *
 * Same input graph → same output (deterministic ordering applied).
 */
export async function detectSupplierCycles(
  client: Neo4jClient,
  opts: SupplierCycleOptions = {},
): Promise<readonly SupplierCycleDetection[]> {
  const maxLen = Math.min(opts.maxLength ?? MAX_CYCLE_LEN, MAX_CYCLE_LEN);

  // Pull payment-flow edges, restricted to company → company.
  const edges = await client.run<{ from: string; to: string }>(
    `MATCH (a:Entity {kind: 'company'})-[r:PAID_TO]->(b:Entity {kind: 'company'})
     RETURN a.id AS from, b.id AS to
     LIMIT 200000`,
  );

  // Build adjacency with capped fan-out.
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.from) ?? [];
    if (list.length < MAX_FANOUT) {
      list.push(e.to);
      out.set(e.from, list);
    }
  }

  const detections: SupplierCycleDetection[] = [];
  for (const start of out.keys()) {
    const cycle = findShortestCycle(start, out, maxLen);
    if (cycle !== null && cycle.length >= 3) {
      detections.push({
        companyId: start,
        cycleLength: cycle.length,
        cycleMembers: cycle,
      });
    }
  }

  return detections.sort((a, b) => a.companyId.localeCompare(b.companyId));
}

/**
 * BFS-based shortest-cycle finder. Returns the first cycle that
 * starts at `start` and walks back to it via outgoing edges, of
 * length ≤ maxLen. Each node visited at most once per BFS layer.
 *
 * Returns the cycle as `[start, n1, n2, ..., nk]` where the implicit
 * closing edge nk → start is present in `out[nk]`. Returned length
 * is the path length (= edge count).
 */
function findShortestCycle(
  start: string,
  out: Map<string, string[]>,
  maxLen: number,
): readonly string[] | null {
  // BFS frontier of paths (each path is a list of node ids ending at
  // the current frontier node). Cap frontier size to keep memory bounded.
  let frontier: string[][] = [[start]];
  const visited = new Set<string>([start]);

  for (let depth = 1; depth <= maxLen; depth += 1) {
    const next: string[][] = [];
    for (const path of frontier) {
      const last = path[path.length - 1]!;
      const neighbours = out.get(last);
      if (!neighbours) continue;
      for (const n of neighbours) {
        // Cycle back to start — only valid if we've taken ≥ 3 hops
        // (A → B → A is too short; need A → B → C → A minimum).
        if (n === start && path.length >= 3) {
          return [...path];
        }
        if (visited.has(n)) continue;
        visited.add(n);
        next.push([...path, n]);
        if (next.length > 5000) break; // safety
      }
      if (next.length > 5000) break;
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return null;
}
