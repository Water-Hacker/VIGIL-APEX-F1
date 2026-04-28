/**
 * Node similarity — Jaccard over shared neighbours, used by the entity
 * resolution review queue (pairs with similarity ≥ 0.70 enter human review).
 */

import type { Neo4jClient } from '../client.js';

export interface NodeSimilarityResult {
  readonly pairs: ReadonlyArray<{ a: string; b: string; jaccard: number }>;
}

export async function nodeSimilarity(
  client: Neo4jClient,
  threshold = 0.7,
  topK = 10_000,
): Promise<NodeSimilarityResult> {
  // Pull adjacency: each entity's set of neighbour IDs
  const rows = await client.run<{ id: string; neighbours: string[] }>(
    `MATCH (e:Entity)
     OPTIONAL MATCH (e)-[:RELATED_TO]-(n:Entity)
     RETURN e.id AS id, collect(DISTINCT n.id) AS neighbours`,
  );
  const setById = new Map<string, Set<string>>();
  for (const r of rows) setById.set(r.id, new Set(r.neighbours));
  const ids = [...setById.keys()];

  const pairs: { a: string; b: string; jaccard: number }[] = [];
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i]!;
    const sa = setById.get(a)!;
    if (sa.size === 0) continue;
    for (let j = i + 1; j < ids.length; j++) {
      const b = ids[j]!;
      const sb = setById.get(b)!;
      if (sb.size === 0) continue;
      // Jaccard
      let inter = 0;
      const small = sa.size < sb.size ? sa : sb;
      const big = sa.size < sb.size ? sb : sa;
      for (const x of small) if (big.has(x)) inter++;
      const union = sa.size + sb.size - inter;
      const jacc = union === 0 ? 0 : inter / union;
      if (jacc >= threshold) pairs.push({ a, b, jaccard: jacc });
    }
  }
  pairs.sort((x, y) => y.jaccard - x.jaccard);
  return { pairs: pairs.slice(0, topK) };
}
