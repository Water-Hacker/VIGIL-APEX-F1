-- Rollback DECISION-010 forward migration. Destructive — run only in dev.

DROP INDEX IF EXISTS dossier.routing_decision_finding_idx;
DROP TABLE IF EXISTS dossier.routing_decision;

ALTER TABLE finding.finding
  DROP CONSTRAINT IF EXISTS finding_recommended_recipient_check;
ALTER TABLE finding.finding
  DROP COLUMN IF EXISTS recommended_recipient_body;

ALTER TABLE finding.finding
  DROP CONSTRAINT IF EXISTS finding_primary_pattern_check;
ALTER TABLE finding.finding
  DROP COLUMN IF EXISTS primary_pattern_id;

DROP INDEX IF EXISTS dossier.dossier_recipient_idx;
ALTER TABLE dossier.dossier
  DROP CONSTRAINT IF EXISTS dossier_recipient_body_check;
ALTER TABLE dossier.dossier
  DROP COLUMN IF EXISTS recipient_body_name;
