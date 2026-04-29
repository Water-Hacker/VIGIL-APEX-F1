import { describe, expect, it } from 'vitest';

import { Cypher } from '../src/queries.js';

describe('@vigil/db-neo4j — Cypher query catalog', () => {
  it('exposes the queries the workers expect', () => {
    for (const k of [
      'upsertEntity',
      'addAlias',
      'addRelationship',
      'directorRings',
      'coIncorporatedCluster',
    ]) {
      expect(Cypher).toHaveProperty(k);
      expect(typeof (Cypher as Record<string, string>)[k]).toBe('string');
      expect((Cypher as Record<string, string>)[k]!.length).toBeGreaterThan(0);
    }
  });

  it('every query references at least one parameter ($name)', () => {
    for (const [name, query] of Object.entries(Cypher)) {
      expect(typeof query).toBe('string');
      expect(query, `${name} should bind at least one $param`).toMatch(/\$\w+/);
    }
  });

  it('upsertEntity matches expected shape (MERGE + SET)', () => {
    expect(Cypher.upsertEntity).toContain('MERGE (e:Entity');
    expect(Cypher.upsertEntity).toContain('SET e += $props');
    expect(Cypher.upsertEntity).toContain('RETURN e');
  });

  it('addAlias links entity → alias via HAS_ALIAS', () => {
    expect(Cypher.addAlias).toContain('HAS_ALIAS');
    expect(Cypher.addAlias).toContain('$entity_id');
    expect(Cypher.addAlias).toContain('$alias');
  });

  it('directorRings filters on shared ≥ threshold', () => {
    expect(Cypher.directorRings).toContain('shared >= $threshold');
  });
});
