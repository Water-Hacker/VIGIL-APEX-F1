/**
 * PageRank — power-iteration implementation against an in-memory edge list
 * pulled from Neo4j. Suitable up to ~2M nodes (MVP scope per SRD §8.4).
 *
 * For production scale, replace with a dedicated graph engine; this module
 * keeps the API stable so swapping is local.
 */

import type { Neo4jClient } from '../client.js';

export interface PageRankOptions {
  readonly damping?: number;
  readonly maxIterations?: number;
  readonly tolerance?: number;
  readonly relationshipKindFilter?: readonly string[];
}

export interface PageRankResult {
  readonly scores: ReadonlyMap<string, number>;
  readonly iterations: number;
}

export async function pageRank(
  client: Neo4jClient,
  opts: PageRankOptions = {},
): Promise<PageRankResult> {
  const damping = opts.damping ?? 0.85;
  const maxIter = opts.maxIterations ?? 50;
  const tolerance = opts.tolerance ?? 1e-6;
  const filter =
    opts.relationshipKindFilter && opts.relationshipKindFilter.length > 0
      ? `AND r.kind IN $kinds`
      : '';

  const rows = await client.run<{ from: string; to: string }>(
    `MATCH (a:Entity)-[r:RELATED_TO]->(b:Entity)
     WHERE 1=1 ${filter}
     RETURN a.id AS from, b.id AS to`,
    opts.relationshipKindFilter ? { kinds: opts.relationshipKindFilter } : {},
  );

  // Build adjacency
  const out = new Map<string, string[]>();
  const all = new Set<string>();
  for (const { from, to } of rows) {
    all.add(from);
    all.add(to);
    if (!out.has(from)) out.set(from, []);
    out.get(from)!.push(to);
  }
  const N = all.size || 1;
  const ids = [...all];

  let rank = new Map<string, number>(ids.map((id) => [id, 1 / N]));
  const teleport = (1 - damping) / N;

  let iter = 0;
  for (; iter < maxIter; iter++) {
    const next = new Map<string, number>(ids.map((id) => [id, teleport]));
    let dangling = 0;
    for (const id of ids) {
      const outs = out.get(id);
      const r = rank.get(id) ?? 0;
      if (!outs || outs.length === 0) {
        dangling += r;
        continue;
      }
      const share = (damping * r) / outs.length;
      for (const o of outs) next.set(o, (next.get(o) ?? 0) + share);
    }
    if (dangling > 0) {
      const each = (damping * dangling) / N;
      for (const id of ids) next.set(id, (next.get(id) ?? 0) + each);
    }
    let delta = 0;
    for (const id of ids) delta += Math.abs((next.get(id) ?? 0) - (rank.get(id) ?? 0));
    rank = next;
    if (delta < tolerance) break;
  }
  return { scores: rank, iterations: iter };
}
