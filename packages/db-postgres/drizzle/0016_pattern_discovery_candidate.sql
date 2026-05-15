-- FRONTIER-AUDIT E1.1 third element — pattern discovery candidate.
--
-- worker-pattern-discovery runs daily, snapshots the Neo4j entity graph,
-- runs the 6 deterministic anomaly detectors, and writes every detected
-- anomaly here for architect / auditor curation. A curated candidate may
-- be promoted to a formal pattern (new P-X-NNN file + tests + DECISION
-- entry) or dismissed.
--
-- The dedup_key is content-derived (kind + entity_ids + window-anchor)
-- so the daily loop is idempotent — a recurring anomaly produces the
-- same candidate id and updates the `last_seen_at` timestamp rather
-- than spawning duplicate rows.

CREATE SCHEMA IF NOT EXISTS pattern_discovery;

CREATE TABLE IF NOT EXISTS pattern_discovery.candidate (
  id                    uuid        PRIMARY KEY,
  dedup_key             text        NOT NULL,
  kind                  text        NOT NULL,
  strength              numeric(5,4) NOT NULL,
  entity_ids_involved   text[]      NOT NULL DEFAULT ARRAY[]::text[],
  rationale             text        NOT NULL,
  evidence              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status                text        NOT NULL DEFAULT 'awaiting_curation',
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  curated_at            timestamptz,
  curated_by            text,
  curation_decision     text,
  curation_notes        text
);

ALTER TABLE pattern_discovery.candidate
  DROP CONSTRAINT IF EXISTS candidate_kind_check;
ALTER TABLE pattern_discovery.candidate
  ADD CONSTRAINT candidate_kind_check
  CHECK (kind IN (
    'stellar_degree',
    'tight_community_outflow',
    'cycle_3_to_6',
    'sudden_mass_creation',
    'burst_then_quiet',
    'triangle_bridge'
  ));

ALTER TABLE pattern_discovery.candidate
  DROP CONSTRAINT IF EXISTS candidate_status_check;
ALTER TABLE pattern_discovery.candidate
  ADD CONSTRAINT candidate_status_check
  CHECK (status IN (
    'awaiting_curation',
    'promoted',
    'dismissed',
    'merged'
  ));

ALTER TABLE pattern_discovery.candidate
  DROP CONSTRAINT IF EXISTS candidate_dedup_unique;
ALTER TABLE pattern_discovery.candidate
  ADD CONSTRAINT candidate_dedup_unique UNIQUE (dedup_key);

CREATE INDEX IF NOT EXISTS candidate_status_idx
  ON pattern_discovery.candidate (status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS candidate_kind_idx
  ON pattern_discovery.candidate (kind, strength DESC);
