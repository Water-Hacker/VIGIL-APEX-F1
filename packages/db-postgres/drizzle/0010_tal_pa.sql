-- @migration-locks-acknowledged: schema-init for audit.user_action_event + audit.user_action_chain. CREATE TABLE + CREATE INDEX in the same DDL batch against empty tables; locks are instantaneous. Future indexes on these tables MUST use CONCURRENTLY.
-- DECISION-012 — TAL-PA: Total Action Logging with Public Anchoring.
--
-- Adds the rich per-event TAL-PA tables alongside the existing
-- audit.actions global hash chain. The global chain remains the
-- source-of-truth for "something happened on the platform"; the new
-- tables add per-actor chaining + actor metadata + public anchoring
-- markers + redaction tracking + anomaly alerts.

-- 1. UserActionEvent — one row per emitted TAL-PA event, FK-linked to
--    the global audit.actions row.
CREATE TABLE IF NOT EXISTS audit.user_action_event (
  event_id                 uuid PRIMARY KEY,
  global_audit_id          uuid NOT NULL,
  event_type               text NOT NULL,
  category                 text NOT NULL,
  timestamp_utc            timestamptz NOT NULL,
  actor_id                 text NOT NULL,
  actor_role               text NOT NULL,
  actor_yubikey_serial     text,
  actor_ip                 text,
  actor_device_fingerprint text,
  session_id               uuid,
  target_resource          text NOT NULL,
  action_payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_status            text NOT NULL,
  prior_event_id           uuid,
  correlation_id           uuid,
  digital_signature        text,
  chain_anchor_tx          text,
  record_hash              text NOT NULL,
  high_significance        boolean NOT NULL DEFAULT false
);

ALTER TABLE audit.user_action_event
  DROP CONSTRAINT IF EXISTS user_action_event_category_check;
ALTER TABLE audit.user_action_event
  ADD CONSTRAINT user_action_event_category_check
  CHECK (category IN ('A','B','C','D','E','F','G','H','I','J','K'));

ALTER TABLE audit.user_action_event
  DROP CONSTRAINT IF EXISTS user_action_event_status_check;
ALTER TABLE audit.user_action_event
  ADD CONSTRAINT user_action_event_status_check
  CHECK (result_status IN ('success','denied','error','partial'));

CREATE INDEX IF NOT EXISTS user_action_event_actor_idx
  ON audit.user_action_event (actor_id, timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS user_action_event_category_idx
  ON audit.user_action_event (category, timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS user_action_event_event_type_idx
  ON audit.user_action_event (event_type, timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS user_action_event_correlation_idx
  ON audit.user_action_event (correlation_id);
CREATE INDEX IF NOT EXISTS user_action_event_high_sig_pending_idx
  ON audit.user_action_event (high_significance, timestamp_utc)
  WHERE high_significance = true AND chain_anchor_tx IS NULL;
CREATE INDEX IF NOT EXISTS user_action_event_unanchored_idx
  ON audit.user_action_event (timestamp_utc)
  WHERE chain_anchor_tx IS NULL;

-- 2. UserActionChain — tracks the most recent event per actor so the SDK
--    can fetch + cas the prior_event_id without a full table scan.
CREATE TABLE IF NOT EXISTS audit.user_action_chain (
  actor_id          text PRIMARY KEY,
  latest_event_id   uuid NOT NULL,
  latest_event_hash text NOT NULL,
  latest_at         timestamptz NOT NULL DEFAULT now(),
  event_count       bigint NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS user_action_chain_latest_at_idx
  ON audit.user_action_chain (latest_at DESC);

-- 3. Session — one row per authenticated session.
CREATE TABLE IF NOT EXISTS audit.session (
  id                  uuid PRIMARY KEY,
  actor_id            text NOT NULL,
  actor_role          text NOT NULL,
  started_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  terminated_at       timestamptz,
  device_fingerprint  text,
  last_ip             text,
  yubikey_serial      text
);

CREATE INDEX IF NOT EXISTS session_actor_idx ON audit.session (actor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS session_active_idx
  ON audit.session (expires_at)
  WHERE terminated_at IS NULL;

-- 4. Redaction — every redacted public-view-field; the redaction itself
--    is also an audit event (audit.actions row of action='redaction.performed').
CREATE TABLE IF NOT EXISTS audit.redaction (
  id              uuid PRIMARY KEY,
  event_id        uuid NOT NULL,
  redacted_fields text[] NOT NULL,
  rationale       text NOT NULL,
  redacted_by     text NOT NULL,
  redacted_at     timestamptz NOT NULL DEFAULT now(),
  audit_event_id  uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS redaction_event_idx ON audit.redaction (event_id);

-- 5. PublicAnchor — high-significance event → individual Polygon tx mapping.
CREATE TABLE IF NOT EXISTS audit.public_anchor (
  id              uuid PRIMARY KEY,
  event_id        uuid NOT NULL,
  polygon_tx_hash text NOT NULL,
  anchored_at     timestamptz NOT NULL DEFAULT now(),
  is_individual   boolean NOT NULL DEFAULT true
);

ALTER TABLE audit.public_anchor
  DROP CONSTRAINT IF EXISTS public_anchor_tx_format_check;
ALTER TABLE audit.public_anchor
  ADD CONSTRAINT public_anchor_tx_format_check
  CHECK (polygon_tx_hash ~ '^0x[a-f0-9]{64}$');

CREATE INDEX IF NOT EXISTS public_anchor_event_idx ON audit.public_anchor (event_id);
CREATE INDEX IF NOT EXISTS public_anchor_anchored_at_idx ON audit.public_anchor (anchored_at DESC);

-- 6. AnomalyAlert — output of worker-audit-watch.
CREATE TABLE IF NOT EXISTS audit.anomaly_alert (
  id                    uuid PRIMARY KEY,
  kind                  text NOT NULL,
  actor_id              text NOT NULL,
  window_start          timestamptz NOT NULL,
  window_end            timestamptz NOT NULL,
  summary_fr            text NOT NULL,
  summary_en            text NOT NULL,
  severity              text NOT NULL,
  rule_version          text NOT NULL,
  triggering_event_ids  uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  detected_at           timestamptz NOT NULL DEFAULT now(),
  state                 text NOT NULL DEFAULT 'open'
);

ALTER TABLE audit.anomaly_alert
  DROP CONSTRAINT IF EXISTS anomaly_alert_severity_check;
ALTER TABLE audit.anomaly_alert
  ADD CONSTRAINT anomaly_alert_severity_check
  CHECK (severity IN ('info','low','medium','high','critical'));
ALTER TABLE audit.anomaly_alert
  DROP CONSTRAINT IF EXISTS anomaly_alert_state_check;
ALTER TABLE audit.anomaly_alert
  ADD CONSTRAINT anomaly_alert_state_check
  CHECK (state IN ('open','acknowledged','dismissed','promoted_to_finding'));

CREATE INDEX IF NOT EXISTS anomaly_alert_actor_idx
  ON audit.anomaly_alert (actor_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS anomaly_alert_open_idx
  ON audit.anomaly_alert (state, severity, detected_at DESC)
  WHERE state = 'open';

-- 7. PublicExportManifest — one row per quarterly anonymised CSV publication.
CREATE TABLE IF NOT EXISTS audit.public_export (
  id              uuid PRIMARY KEY,
  period_label    text NOT NULL UNIQUE,
  period_start    timestamptz NOT NULL,
  period_end      timestamptz NOT NULL,
  csv_sha256      text NOT NULL,
  csv_cid         text NOT NULL,
  row_count       integer NOT NULL,
  exported_at     timestamptz NOT NULL DEFAULT now(),
  audit_event_id  uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS public_export_period_idx ON audit.public_export (period_start DESC);
