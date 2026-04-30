-- Down migration for 0012_audit_export_salt_fingerprint.sql.

DROP VIEW IF EXISTS audit.public_export_salt_collisions;

ALTER TABLE audit.public_export
  DROP COLUMN IF EXISTS salt_fingerprint;
