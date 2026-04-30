-- AUDIT-024: salt-rotation visibility for the TAL-PA quarterly export.
--
-- Pre-fix the quarterly export's PII salt rotation cadence
-- ("rotates per quarter") was operationally enforced but invisible
-- to the runtime — an operator who forgot to rotate would produce
-- rainbow-tableable hashes across consecutive quarters with no
-- detection until a researcher spotted the pattern in the public
-- export.
--
-- Add `salt_fingerprint` (first 8 hex of sha256(salt)) to every
-- audit.public_export row. The quarterly trigger writes it; an
-- alert rule fires when two consecutive exports share a fingerprint.

ALTER TABLE audit.public_export
  ADD COLUMN IF NOT EXISTS salt_fingerprint char(8);

-- Backfill: existing rows have no recorded salt; mark them as 'PRE-024'
-- so the alert query can distinguish "old, no fingerprint" from "new
-- duplicate fingerprint".
UPDATE audit.public_export
   SET salt_fingerprint = 'PRE-024'
 WHERE salt_fingerprint IS NULL;

ALTER TABLE audit.public_export
  ALTER COLUMN salt_fingerprint SET NOT NULL;

-- Helper view used by the alert query (no rows from PRE-024 backfill).
CREATE OR REPLACE VIEW audit.public_export_salt_collisions AS
SELECT
  curr.id           AS curr_id,
  curr.period_label AS curr_period,
  prev.period_label AS prev_period,
  curr.salt_fingerprint
FROM audit.public_export AS curr
JOIN audit.public_export AS prev
  ON prev.exported_at < curr.exported_at
 AND prev.salt_fingerprint = curr.salt_fingerprint
 AND prev.salt_fingerprint <> 'PRE-024'
WHERE curr.salt_fingerprint <> 'PRE-024';
