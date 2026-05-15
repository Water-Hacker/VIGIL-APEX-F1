-- Rollback for 0017_finding_revision.sql — destructive, dev only.
--
-- Drops the revision column. Any caller passing expectedRevision will
-- fail at the type level (the schema column is gone). Safe in dev where
-- the column is being abandoned; UNSAFE in prod where existing
-- CAS-using callers would silently regress to last-write-wins.

ALTER TABLE finding.finding DROP COLUMN IF EXISTS revision;
