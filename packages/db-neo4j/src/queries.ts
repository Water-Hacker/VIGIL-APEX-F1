/**
 * Cypher query templates used by workers (SRD §8.3).
 *
 * Stored as constants here to keep them lint-checkable and reusable.
 */

export const Cypher = {
  upsertEntity: `
    MERGE (e:Entity {id: $id})
    SET e += $props
    RETURN e
  `,
  addAlias: `
    MATCH (e:Entity {id: $entity_id})
    MERGE (a:Alias {value: $alias, source: $source_id})
    SET a.language = $language, a.first_seen = coalesce(a.first_seen, $first_seen)
    MERGE (e)-[:HAS_ALIAS]->(a)
  `,
  addRelationship: `
    MATCH (a:Entity {id: $from})
    MATCH (b:Entity {id: $to})
    MERGE (a)-[r:RELATED_TO {kind: $kind}]->(b)
    SET r.evidence_strength = $strength,
        r.last_seen = $last_seen,
        r.first_seen = coalesce(r.first_seen, $first_seen)
  `,
  // Director-sharing ring detection — used by P-F-002
  directorRings: `
    MATCH (p:Entity)-[:DIRECTOR_OF]->(c1:Entity)<-[:DIRECTOR_OF]-(p2:Entity)
    WHERE p.id < p2.id
    WITH p, p2, count(c1) AS shared
    WHERE shared >= $threshold
    RETURN p.id AS person_a, p2.id AS person_b, shared
  `,
  // Co-incorporated cluster — P-B-005
  coIncorporatedCluster: `
    MATCH (a:Entity)-[:INCORPORATED_AT]->(d:Date)<-[:INCORPORATED_AT]-(b:Entity)
    WHERE a.id < b.id AND duration.between(d.value, $reference_date).days < $window_days
    RETURN a.id, b.id, d.value AS incorporation_date
  `,
  // PageRank seed query — surfaces top central entities for review
  topCentralEntities: `
    MATCH (e:Entity)-[r:RELATED_TO]-()
    WITH e, count(r) AS deg
    ORDER BY deg DESC
    LIMIT $limit
    RETURN e.id, e.display_name, deg
  `,
} as const;
