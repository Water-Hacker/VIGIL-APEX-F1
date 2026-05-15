-- @migration-locks-acknowledged: ALTER TABLE ADD COLUMN bigint NOT NULL DEFAULT 0 — Postgres 11+ "missing default" tuple representation makes this O(1) (no rewrite). No CREATE INDEX in this migration. Pre-prod tables with millions of rows: this is safe in production.
--
-- Hardening mode 2.8 — Lost-write last-write-wins on finding setters.
--
-- Pre-closure: `finding.finding`.setPosterior, setState, setCounterEvidence,
-- setRecommendedRecipientBody are single-row UPDATEs without compare-and-
-- swap. Two concurrent workers can both succeed, but one's write is
-- silently overwritten. For an audit-pipeline this is unacceptable: the
-- second worker BELIEVES the value it wrote is the canonical value, when
-- in fact a later concurrent write replaced it.
--
-- Closure: add a `revision` column. Each setter takes an optional
-- `expectedRevision` parameter and includes `AND revision = $expected`
-- in its WHERE clause + increments revision on every write. Callers
-- that pass `expectedRevision` get fail-fast CAS semantics; callers
-- that don't continue with last-write-wins (backward compat).
--
-- The revision is monotonic per row, never reset. Bigint chosen to
-- avoid wraparound (a finding mutated 10^9 times in its lifetime is
-- not a real scenario, but bigint is the safe default).

ALTER TABLE finding.finding
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN finding.finding.revision IS
  'Monotonic optimistic-lock counter. Incremented on every UPDATE by FindingRepo setters. Callers MAY pass expectedRevision to get CAS-conflict-on-mismatch (hardening mode 2.8). Never decrease; never reset.';
