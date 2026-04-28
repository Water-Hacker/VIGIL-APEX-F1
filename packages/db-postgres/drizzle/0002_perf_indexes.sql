-- 0002_perf_indexes.sql — Phase D2 + D3 country-scale composite indexes.
--
-- Country-scale workload at 100K+ contracts/year × 43 patterns implies
-- O(10^7) signal rows and O(10^5) findings/yr. The single-column indexes
-- shipped in 0001 are sufficient for individual lookups but compound
-- filters (e.g. "active findings, by posterior, recent first") force a
-- bitmap-OR + sort that pages out under load.
--
-- All CREATE INDEX statements are CONCURRENTLY-safe in production
-- (separate migration script invokes with `CONCURRENTLY` based on
-- $POSTGRES_INDEX_CONCURRENT). The plain form here is what a fresh
-- bootstrap runs.

------------------------------------------------------------------------
-- D2 — finding.finding hot path (operator dashboard, escalation queue)
------------------------------------------------------------------------
-- Filters by state IN (...) AND ORDER BY posterior DESC NULLS LAST,
-- detected_at DESC. PARTIAL on the active-state set keeps the index
-- ~10× smaller than a full-table version.
CREATE INDEX IF NOT EXISTS finding_state_posterior_detected_idx
  ON finding.finding (state, posterior DESC NULLS LAST, detected_at DESC)
  WHERE state IN ('detected', 'review', 'council_review', 'escalated');

-- Severity + recency cut for the dashboard's "critical first" view.
CREATE INDEX IF NOT EXISTS finding_severity_state_idx
  ON finding.finding (severity, state, detected_at DESC)
  WHERE state IN ('detected', 'review', 'council_review', 'escalated');

------------------------------------------------------------------------
-- D3 — entity.canonical / entity.relationship hot paths
------------------------------------------------------------------------
-- Partial on rccm_number IS NOT NULL — most rows have NULL rccm.
CREATE INDEX IF NOT EXISTS canonical_rccm_partial_idx
  ON entity.canonical (rccm_number)
  WHERE rccm_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS canonical_niu_partial_idx
  ON entity.canonical (niu)
  WHERE niu IS NOT NULL;

-- 1-hop neighbour query: WHERE from_canonical_id = $1 AND kind = ANY($2).
CREATE INDEX IF NOT EXISTS relationship_from_kind_idx
  ON entity.relationship (from_canonical_id, kind);

CREATE INDEX IF NOT EXISTS relationship_to_kind_idx
  ON entity.relationship (to_canonical_id, kind);

------------------------------------------------------------------------
-- finding.signal — fast lookup for evidence chain rendering on
-- /findings/[id] (Phase C4) — joins by finding_id and orders by
-- contributed_at DESC.
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS signal_finding_contributed_idx
  ON finding.signal (finding_id, contributed_at DESC);

------------------------------------------------------------------------
-- source.dead_letter — dashboard /dead-letter (Phase C8) lists
-- unresolved rows ordered by last_attempt DESC.
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS dead_letter_unresolved_idx
  ON source.dead_letter (last_attempt DESC)
  WHERE resolved_at IS NULL;
