/**
 * Louvain community detection — single-pass implementation.
 *
 * Returns a community ID per node. Used to surface clusters of related
 * shell-companies / director-rings (pattern category F).
 */

import type { Neo4jClient } from '../client.js';

export interface LouvainOptions {
  readonly maxPasses?: number;
}

export interface LouvainResult {
  readonly communities: ReadonlyMap<string, number>;
  readonly modularity: number;
}

export async function louvain(client: Neo4jClient, opts: LouvainOptions = {}): Promise<LouvainResult> {
  const maxPasses = opts.maxPasses ?? 5;
  const rows = await client.run<{ a: string; b: string; w: number }>(
    `MATCH (a:Entity)-[r:RELATED_TO]-(b:Entity)
     WHERE id(a) < id(b)
     RETURN a.id AS a, b.id AS b, coalesce(r.evidence_strength, 1.0) AS w`,
  );

  const adj = new Map<string, Map<string, number>>();
  let totalWeight = 0;
  for (const { a, b, w } of rows) {
    if (!adj.has(a)) adj.set(a, new Map());
    if (!adj.has(b)) adj.set(b, new Map());
    adj.get(a)!.set(b, (adj.get(a)!.get(b) ?? 0) + w);
    adj.get(b)!.set(a, (adj.get(b)!.get(a) ?? 0) + w);
    totalWeight += w;
  }
  const m2 = 2 * totalWeight || 1;

  const ids = [...adj.keys()];
  const community = new Map<string, number>(ids.map((id, i) => [id, i]));
  const degree = new Map<string, number>(
    ids.map((id) => [id, [...(adj.get(id)?.values() ?? [])].reduce((a, b) => a + b, 0)]),
  );

  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    for (const node of ids) {
      const cur = community.get(node)!;
      const neighbours = adj.get(node) ?? new Map<string, number>();
      const ki = degree.get(node) ?? 0;
      let best = cur;
      let bestGain = 0;
      const candidateScores = new Map<number, number>();
      for (const [n, w] of neighbours) {
        const c = community.get(n)!;
        candidateScores.set(c, (candidateScores.get(c) ?? 0) + w);
      }
      for (const [c, kIn] of candidateScores) {
        if (c === cur) continue;
        const sigmaTot = ids.filter((i) => community.get(i) === c).reduce((acc, i) => acc + (degree.get(i) ?? 0), 0);
        const gain = kIn - (sigmaTot * ki) / m2;
        if (gain > bestGain) {
          bestGain = gain;
          best = c;
        }
      }
      if (best !== cur) {
        community.set(node, best);
        moved = true;
      }
    }
    if (!moved) break;
  }

  // Re-number communities densely (0..k-1)
  const remap = new Map<number, number>();
  let nextId = 0;
  for (const c of community.values()) {
    if (!remap.has(c)) remap.set(c, nextId++);
  }
  const dense = new Map<string, number>();
  for (const [k, v] of community) dense.set(k, remap.get(v)!);

  // Modularity (rough)
  let q = 0;
  for (const a of ids) {
    for (const [b, wAb] of adj.get(a) ?? new Map<string, number>()) {
      if (community.get(a) !== community.get(b)) continue;
      const ka = degree.get(a) ?? 0;
      const kb = degree.get(b) ?? 0;
      q += wAb - (ka * kb) / m2;
    }
  }
  q /= m2;

  return { communities: dense, modularity: q };
}
