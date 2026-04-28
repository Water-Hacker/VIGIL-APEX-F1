-- 0003_audit_pipeline.sql — Phase E7. Postgres-side sink for the Vault
-- audit log shipped via Filebeat → Logstash. Append-only by design;
-- the audit-immutability trigger from 0001 is not applied here because
-- the upstream system (Vault) is already the source of truth — we only
-- need a queryable mirror for cross-correlation with finding events.

CREATE TABLE IF NOT EXISTS audit.vault_log (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  time      TIMESTAMPTZ NOT NULL,
  type      TEXT        NOT NULL,        -- 'request' or 'response'
  auth      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  request   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  response  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  raw       JSONB       NOT NULL,        -- full event for forensic replay
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vault_log_time_idx
  ON audit.vault_log (time DESC);

CREATE INDEX IF NOT EXISTS vault_log_path_idx
  ON audit.vault_log ((request->>'path'));

CREATE INDEX IF NOT EXISTS vault_log_actor_idx
  ON audit.vault_log ((auth->>'display_name'));
