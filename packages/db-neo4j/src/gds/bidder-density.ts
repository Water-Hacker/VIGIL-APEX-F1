/**
 * Per-tender bidder-graph density.
 *
 * Pattern P-F-005: bidders for the same tender form a dense subgraph
 * (shared directors / addresses / shareholders). Density ≥ 0.6 strongly
 * suggests bid-rigging even when individual director-overlap is below
 * P-F-002's pairwise threshold.
 *
 * Definition: density = (# pairwise-related bidder pairs) / (n choose 2)
 * where n is the bidder count for the tender. "Pairwise-related" means
 * the two companies share at least one of: director, registered address,
 * majority shareholder, beneficial owner.
 *
 * Output: tender_id → density in [0,1]. Persisted onto the award event
 * payload as `bidder_graph_density` so P-F-005's existing detect()
 * function reads it without refactor.
 *
 * Hardening:
 *   - Per-tender bidder cap (MAX_BIDDERS) — pathologically large bidder
 *     sets are clamped before the O(n²) pair count.
 *   - Empty / single-bidder tenders skipped (density undefined).
 */

import type { Neo4jClient } from '../client.js';

const MAX_BIDDERS = 100;

export interface BidderDensity {
  readonly tenderId: string;
  readonly bidderCount: number;
  readonly density: number;
}

export async function computeBidderDensity(client: Neo4jClient): Promise<readonly BidderDensity[]> {
  // Tender → bidders (capped)
  const bidderRows = await client.run<{ tender: string; bidder: string }>(
    `MATCH (c:Entity {kind: 'company'})-[:BID_FOR]->(t:Tender)
     RETURN t.id AS tender, c.id AS bidder
     LIMIT 200000`,
  );
  const tenderToBidders = new Map<string, string[]>();
  for (const row of bidderRows) {
    const arr = tenderToBidders.get(row.tender) ?? [];
    if (arr.length < MAX_BIDDERS) {
      arr.push(row.bidder);
      tenderToBidders.set(row.tender, arr);
    }
  }

  // Pairwise relations among companies (any of the listed kinds counts)
  const relRows = await client.run<{ a: string; b: string }>(
    `MATCH (a:Entity {kind: 'company'})-[r:RELATED_TO]-(b:Entity {kind: 'company'})
     WHERE r.via IN ['director', 'registered_address', 'majority_shareholder', 'ubo']
     AND id(a) < id(b)
     RETURN a.id AS a, b.id AS b
     LIMIT 500000`,
  );
  const related = new Set<string>();
  for (const r of relRows) {
    const key = r.a < r.b ? `${r.a}|${r.b}` : `${r.b}|${r.a}`;
    related.add(key);
  }

  const out: BidderDensity[] = [];
  for (const [tenderId, bidders] of tenderToBidders) {
    if (bidders.length < 2) continue;
    let pairs = 0;
    let connected = 0;
    for (let i = 0; i < bidders.length; i += 1) {
      for (let j = i + 1; j < bidders.length; j += 1) {
        pairs += 1;
        const a = bidders[i]!;
        const b = bidders[j]!;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (related.has(key)) connected += 1;
      }
    }
    const density = pairs === 0 ? 0 : connected / pairs;
    out.push({ tenderId, bidderCount: bidders.length, density });
  }
  return out.sort((a, b) => a.tenderId.localeCompare(b.tenderId));
}
