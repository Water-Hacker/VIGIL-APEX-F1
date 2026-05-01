-- Down-migration for 0013_canonical_neo4j_mirror_state.sql

DROP INDEX IF EXISTS entity.canonical_neo4j_mirror_state_idx;

ALTER TABLE entity.canonical
  DROP CONSTRAINT IF EXISTS canonical_neo4j_mirror_state_check;

ALTER TABLE entity.canonical
  DROP COLUMN IF EXISTS neo4j_mirror_state;
