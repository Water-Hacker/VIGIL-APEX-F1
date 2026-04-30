/**
 * Director-ring detector.
 *
 * Pattern P-F-002: multiple competing bidders share ≥ 2 directors. Canonical
 * bid-rigging signal — a rotating cartel can avoid scrutiny if no individual
 * director appears on more than one company, but the same RING of directors
 * shows up across competing bids.
 *
 * Implementation: build the bipartite graph (Person ↔ Company) from
 * `IS_DIRECTOR_OF` edges; for each Person count distinct Companies; flag
 * a Person as "ring member" iff they share ≥ 2 directorships AND the set
 * of Companies they directorate has any pair that competed for the same
 * tender.
 *
 * Output: a set of Person ids to mark with `metadata.directorRingFlag=true`.
 *
 * Hardening:
 *   - Pair-count capped per person (MAX_DIRECTORSHIPS) to prevent
 *     pathological inputs from blowing memory.
 *   - Tender-competitor set capped (MAX_BIDDERS_PER_TENDER) — same reason.
 *   - Returns deterministic ordering.
 */

import type { Neo4jClient } from '../client.js';

const MAX_DIRECTORSHIPS = 100;
const MAX_BIDDERS_PER_TENDER = 200;

export interface DirectorRingDetection {
  readonly personId: string;
  readonly sharedTenderIds: ReadonlyArray<string>;
  readonly companyIds: ReadonlyArray<string>;
}

export async function detectDirectorRings(
  client: Neo4jClient,
): Promise<readonly DirectorRingDetection[]> {
  // Person → Company directorships
  const directorships = await client.run<{ person: string; company: string }>(
    `MATCH (p:Entity {kind: 'person'})-[:IS_DIRECTOR_OF]->(c:Entity {kind: 'company'})
     RETURN p.id AS person, c.id AS company
     LIMIT 100000`,
  );

  // Tender → bidder set
  const tenderBidders = await client.run<{ tender: string; company: string }>(
    `MATCH (c:Entity {kind: 'company'})-[:BID_FOR]->(t:Tender)
     RETURN t.id AS tender, c.id AS company
     LIMIT 200000`,
  );

  // Index: person → companies they direct
  const personToCompanies = new Map<string, Set<string>>();
  for (const d of directorships) {
    const set = personToCompanies.get(d.person) ?? new Set();
    if (set.size < MAX_DIRECTORSHIPS) {
      set.add(d.company);
      personToCompanies.set(d.person, set);
    }
  }

  // Index: tender → bidder companies
  const tenderToCompanies = new Map<string, Set<string>>();
  for (const tb of tenderBidders) {
    const set = tenderToCompanies.get(tb.tender) ?? new Set();
    if (set.size < MAX_BIDDERS_PER_TENDER) {
      set.add(tb.company);
      tenderToCompanies.set(tb.tender, set);
    }
  }

  // For each tender, intersect bidder set with each person's companies
  // — if intersection ≥ 2, that person is a ring member for that tender.
  const ringMembers = new Map<string, { tenders: Set<string>; companies: Set<string> }>();

  for (const [tenderId, bidders] of tenderToCompanies) {
    if (bidders.size < 2) continue;
    for (const [personId, companiesDirected] of personToCompanies) {
      let overlap = 0;
      const overlapSet = new Set<string>();
      for (const c of bidders) {
        if (companiesDirected.has(c)) {
          overlap += 1;
          overlapSet.add(c);
          if (overlap >= 2) break;
        }
      }
      if (overlap >= 2) {
        const entry = ringMembers.get(personId) ?? {
          tenders: new Set<string>(),
          companies: new Set<string>(),
        };
        entry.tenders.add(tenderId);
        for (const c of overlapSet) entry.companies.add(c);
        ringMembers.set(personId, entry);
      }
    }
  }

  return [...ringMembers.entries()]
    .map(([personId, info]) => ({
      personId,
      sharedTenderIds: [...info.tenders].sort(),
      companyIds: [...info.companies].sort(),
    }))
    .sort((a, b) => a.personId.localeCompare(b.personId));
}
