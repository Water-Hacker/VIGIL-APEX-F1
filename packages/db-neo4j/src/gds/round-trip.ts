/**
 * Round-trip payment detector.
 *
 * Pattern P-F-001: funds disbursed to supplier A return — directly or after
 * one or two hops — to an account controlled by the awarding authority's
 * officer (or their known kin).
 *
 * Implementation: bounded-depth BFS over `paid_to` / `paid_by` edges.
 * For each Company that received funds in the last N days, walk forward
 * up to MAX_HOPS along outgoing payment edges; if any path terminates at
 * a Person tagged with `is_pep=true` OR `is_kin_of_official=true` who is
 * also linked to the contracting authority of the original award, mark
 * the supplier's metadata `roundTripDetected=true` and record the
 * shortest hop count.
 *
 * Hardening:
 *   - Bounded depth (MAX_HOPS) — no exponential blow-up on dense graphs.
 *   - Bounded fan-out per node (MAX_FANOUT) — no DoS by injecting a
 *     pathological supplier with thousands of out-edges.
 *   - Visited-set per BFS — no infinite loops on cycles.
 *   - Returns deterministic result (same edge set → same result).
 */

import type { Neo4jClient } from '../client.js';

const MAX_HOPS = 3;
const MAX_FANOUT = 200;

export interface RoundTripDetection {
  readonly supplierId: string;
  readonly awardingOfficerId: string;
  readonly hops: number;
}

export interface RoundTripOptions {
  /** Window in days of payments to walk; default 365. */
  readonly windowDays?: number;
}

/**
 * Computes round-trip detections across the full graph.
 *
 * Returns an array of per-supplier hits. Empty array means no detections.
 * Same input graph → same output (sort by supplierId before persisting).
 */
export async function detectRoundTrips(
  client: Neo4jClient,
  opts: RoundTripOptions = {},
): Promise<readonly RoundTripDetection[]> {
  const windowDays = opts.windowDays ?? 365;

  // Collect (supplier, awardingAuthority) pairs from awards in window
  const awards = await client.run<{ supplier: string; authority: string; ts: string }>(
    `MATCH (s:Entity {kind: 'company'})-[:AWARDED_BY]->(:Tender)<-[:ISSUED]-(a:Entity)
     WHERE s.last_event_at > datetime() - duration({days: $win})
     RETURN s.id AS supplier, a.id AS authority, toString(s.last_event_at) AS ts
     LIMIT 50000`,
    { win: windowDays },
  );

  // Collect payment-flow edges: (from, to)
  const edges = await client.run<{ from: string; to: string }>(
    `MATCH (a:Entity)-[r:PAID_TO]->(b:Entity)
     RETURN a.id AS from, b.id AS to
     LIMIT 200000`,
  );

  // Collect which Persons are linked to which authorities (officer / kin links)
  const officerLinks = await client.run<{ authority: string; person: string }>(
    `MATCH (a:Entity)-[:OFFICER_OF|KIN_OF|CONTROLLED_BY]->(p:Entity {kind: 'person'})
     WHERE p.is_pep = true OR p.is_kin_of_official = true
     RETURN a.id AS authority, p.id AS person
     LIMIT 50000`,
  );

  // Build adjacency
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.from) ?? [];
    if (list.length < MAX_FANOUT) {
      list.push(e.to);
      out.set(e.from, list);
    }
  }

  // Map authority → set of officers (for fast hit-test)
  const authorityToOfficers = new Map<string, Set<string>>();
  for (const link of officerLinks) {
    if (!authorityToOfficers.has(link.authority)) {
      authorityToOfficers.set(link.authority, new Set());
    }
    authorityToOfficers.get(link.authority)!.add(link.person);
  }

  const hits: RoundTripDetection[] = [];

  for (const award of awards) {
    const officers = authorityToOfficers.get(award.authority);
    if (!officers || officers.size === 0) continue;

    // BFS from supplier looking for officer
    const result = bfsToTarget(award.supplier, officers, out);
    if (result !== null) {
      hits.push({
        supplierId: award.supplier,
        awardingOfficerId: result.target,
        hops: result.hops,
      });
    }
  }

  // Deterministic ordering
  return [...hits].sort((a, b) => {
    if (a.supplierId !== b.supplierId) return a.supplierId.localeCompare(b.supplierId);
    return a.hops - b.hops;
  });
}

function bfsToTarget(
  start: string,
  targets: Set<string>,
  out: Map<string, string[]>,
): { target: string; hops: number } | null {
  if (targets.has(start)) return { target: start, hops: 0 };
  let frontier: string[] = [start];
  const visited = new Set<string>([start]);
  for (let depth = 1; depth <= MAX_HOPS; depth++) {
    const next: string[] = [];
    for (const node of frontier) {
      const neighbours = out.get(node);
      if (!neighbours) continue;
      for (const n of neighbours) {
        if (visited.has(n)) continue;
        visited.add(n);
        if (targets.has(n)) return { target: n, hops: depth };
        next.push(n);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return null;
}
