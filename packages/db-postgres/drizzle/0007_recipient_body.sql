-- DECISION-010 — per-finding recipient-body routing
--
-- Forward migration. Reverse is in 0007_recipient_body_down.sql.

-- 1. Add recipient_body_name to dossier table.
--    NOT NULL with default 'CONAC' so historical rows backfill cleanly.
ALTER TABLE dossier.dossier
  ADD COLUMN IF NOT EXISTS recipient_body_name text NOT NULL DEFAULT 'CONAC';

-- 2. Constrain values to the allowed set (matches Schemas.RecipientBody).
ALTER TABLE dossier.dossier
  DROP CONSTRAINT IF EXISTS dossier_recipient_body_check;
ALTER TABLE dossier.dossier
  ADD CONSTRAINT dossier_recipient_body_check
  CHECK (recipient_body_name IN ('CONAC','COUR_DES_COMPTES','MINFI','ANIF','CDC','OTHER'));

-- 3. Index for delivery-worker dispatch and operator filters.
CREATE INDEX IF NOT EXISTS dossier_recipient_idx
  ON dossier.dossier (recipient_body_name, status);

-- 4. Recommended-recipient column on finding (nullable; pre-populated by
--    worker-score; surfaced in council UI; informs the auto-default).
ALTER TABLE finding.finding
  ADD COLUMN IF NOT EXISTS recommended_recipient_body text;

ALTER TABLE finding.finding
  DROP CONSTRAINT IF EXISTS finding_recommended_recipient_check;
ALTER TABLE finding.finding
  ADD CONSTRAINT finding_recommended_recipient_check
  CHECK (
    recommended_recipient_body IS NULL
    OR recommended_recipient_body IN ('CONAC','COUR_DES_COMPTES','MINFI','ANIF','CDC','OTHER')
  );

-- 4b. Primary-pattern-id denormalisation. The pattern category drives the
--     auto routing default; pre-populated by worker-score whenever it
--     consumes a stronger pattern signal. Nullable while the finding has
--     not yet seen a signal.
ALTER TABLE finding.finding
  ADD COLUMN IF NOT EXISTS primary_pattern_id text;

ALTER TABLE finding.finding
  DROP CONSTRAINT IF EXISTS finding_primary_pattern_check;
ALTER TABLE finding.finding
  ADD CONSTRAINT finding_primary_pattern_check
  CHECK (
    primary_pattern_id IS NULL
    OR primary_pattern_id ~ '^P-[A-H]-[0-9]{3}$'
  );

-- 5. Routing-decision audit table — one row per recipient change.
CREATE TABLE IF NOT EXISTS dossier.routing_decision (
  id                  uuid PRIMARY KEY,
  finding_id          uuid NOT NULL,
  recipient_body_name text NOT NULL,
  source              text NOT NULL,
  decided_by          text NOT NULL,
  decided_at          timestamptz NOT NULL DEFAULT now(),
  rationale           text NOT NULL
);

ALTER TABLE dossier.routing_decision
  DROP CONSTRAINT IF EXISTS routing_decision_body_check;
ALTER TABLE dossier.routing_decision
  ADD CONSTRAINT routing_decision_body_check
  CHECK (recipient_body_name IN ('CONAC','COUR_DES_COMPTES','MINFI','ANIF','CDC','OTHER'));

ALTER TABLE dossier.routing_decision
  DROP CONSTRAINT IF EXISTS routing_decision_source_check;
ALTER TABLE dossier.routing_decision
  ADD CONSTRAINT routing_decision_source_check
  CHECK (source IN ('auto','operator','council'));

CREATE INDEX IF NOT EXISTS routing_decision_finding_idx
  ON dossier.routing_decision (finding_id, decided_at DESC);
