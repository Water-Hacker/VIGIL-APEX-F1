-- Block-A reconciliation §5.b — Neo4j-mirror-state visibility on
-- entity.canonical (architect-approved 2026-05-01).
--
-- Background: worker-entity writes Postgres FIRST, then attempts a
-- best-effort Neo4j mirror. Until this migration, mirror failures
-- were logged-and-forgotten — there was no way to ask "which canonical
-- rows have a stale or missing Neo4j twin?". This column makes the
-- mirror state queryable, plus provides the substrate for the
-- vigil_neo4j_mirror_state_total{state} Prometheus gauge.
--
-- Scope is intentionally narrow: one column, one CHECK constraint,
-- one index. The reconcile-stale-rows worker is OUT OF SCOPE for
-- this migration (deferred to the Neo4j retry-queue track).

ALTER TABLE entity.canonical
  ADD COLUMN IF NOT EXISTS neo4j_mirror_state text NOT NULL DEFAULT 'pending';

ALTER TABLE entity.canonical
  DROP CONSTRAINT IF EXISTS canonical_neo4j_mirror_state_check;
ALTER TABLE entity.canonical
  ADD CONSTRAINT canonical_neo4j_mirror_state_check
  CHECK (neo4j_mirror_state IN ('synced', 'pending', 'failed'));

-- Indexed because the metric query is `GROUP BY neo4j_mirror_state`
-- across the full table; without an index that's a sequential scan
-- every Prometheus scrape interval (default 15s).
CREATE INDEX IF NOT EXISTS canonical_neo4j_mirror_state_idx
  ON entity.canonical (neo4j_mirror_state);
