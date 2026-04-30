/**
 * Hub-and-spoke procurement-vehicle detector.
 *
 * Pattern P-F-004: One contracting authority (the "hub") accounts for
 * ≥ 70 % of contracts won by a given supplier (the "spoke"), and the
 * supplier wins from very few other authorities. The supplier exists
 * as a vehicle for a single buyer.
 *
 * Implementation: aggregates AWARDED_BY edges grouped by supplier.
 * Per supplier: total contract count, count per authority, the top
 * authority's share. Records authorityConcentrationRatio +
 * publicContractsCount on the supplier's metadata for the pattern
 * detect() to read.
 *
 * Hardening:
 *   - LIMIT 200_000 on the Cypher query caps the result size.
 *   - Returns deterministic ordering (sort by supplier id).
 *   - Suppliers with < MIN_CONTRACTS contracts skipped (the pattern
 *     itself also gates at 3, but the metric job double-checks).
 */

import type { Neo4jClient } from '../client.js';

const MIN_CONTRACTS = 3;

export interface HubAndSpokeMetric {
  readonly supplierId: string;
  /** Total public contracts won by this supplier. */
  readonly publicContractsCount: number;
  /** Hub authority's id. */
  readonly hubAuthorityId: string;
  /** Hub's share of the supplier's contracts (0-1). */
  readonly authorityConcentrationRatio: number;
  /** Number of distinct contracting authorities the supplier has won from. */
  readonly distinctAuthorities: number;
}

export async function computeHubAndSpoke(
  client: Neo4jClient,
): Promise<readonly HubAndSpokeMetric[]> {
  // Pull (supplier, authority) pairs from awards.
  const rows = await client.run<{ supplier: string; authority: string }>(
    `MATCH (s:Entity {kind: 'company'})-[:AWARDED_BY]->(t:Tender)<-[:ISSUED]-(a:Entity)
     RETURN s.id AS supplier, a.id AS authority
     LIMIT 200000`,
  );

  // Per supplier: total + per-authority counts.
  const perSupplier = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const counts = perSupplier.get(r.supplier) ?? new Map<string, number>();
    counts.set(r.authority, (counts.get(r.authority) ?? 0) + 1);
    perSupplier.set(r.supplier, counts);
  }

  const metrics: HubAndSpokeMetric[] = [];
  for (const [supplier, counts] of perSupplier) {
    let total = 0;
    let topAuthority = '';
    let topCount = 0;
    for (const [authority, count] of counts) {
      total += count;
      if (count > topCount) {
        topCount = count;
        topAuthority = authority;
      }
    }
    if (total < MIN_CONTRACTS) continue;
    metrics.push({
      supplierId: supplier,
      publicContractsCount: total,
      hubAuthorityId: topAuthority,
      authorityConcentrationRatio: topCount / total,
      distinctAuthorities: counts.size,
    });
  }

  return metrics.sort((a, b) => a.supplierId.localeCompare(b.supplierId));
}

export const HUB_SPOKE_MIN_CONTRACTS = MIN_CONTRACTS;
