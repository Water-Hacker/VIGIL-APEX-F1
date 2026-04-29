-- DECISION-010 — satellite-verification request tracking
--
-- The dashboard "satellite recheck" button and the daily satellite-trigger
-- adapter both write here, idempotent on (project_id, contract_window).
-- The Python worker-satellite updates `status`, `activity_score`, etc.
-- as it progresses.

CREATE TABLE IF NOT EXISTS dossier.satellite_request (
  id              uuid PRIMARY KEY,
  project_id      uuid NOT NULL,
  contract_start  date NOT NULL,
  contract_end    date NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  request_id      text NOT NULL,
  status          text NOT NULL DEFAULT 'queued',
  provider_used   text,
  scene_count     integer,
  activity_score  numeric(5,4),
  cost_usd        numeric(10,4) DEFAULT 0,
  error_message   text,
  result_cid      text
);

ALTER TABLE dossier.satellite_request
  DROP CONSTRAINT IF EXISTS satellite_request_status_check;
ALTER TABLE dossier.satellite_request
  ADD CONSTRAINT satellite_request_status_check
  CHECK (status IN ('queued','in_progress','completed','failed'));

ALTER TABLE dossier.satellite_request
  DROP CONSTRAINT IF EXISTS satellite_request_provider_check;
ALTER TABLE dossier.satellite_request
  ADD CONSTRAINT satellite_request_provider_check
  CHECK (
    provider_used IS NULL
    OR provider_used IN ('nicfi','sentinel-2','sentinel-1','maxar','airbus')
  );

ALTER TABLE dossier.satellite_request
  DROP CONSTRAINT IF EXISTS satellite_request_project_window_unique;
ALTER TABLE dossier.satellite_request
  ADD CONSTRAINT satellite_request_project_window_unique
  UNIQUE (project_id, contract_start, contract_end);

CREATE INDEX IF NOT EXISTS satellite_request_status_idx
  ON dossier.satellite_request (status, requested_at);
