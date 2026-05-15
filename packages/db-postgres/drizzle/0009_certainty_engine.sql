-- @migration-locks-acknowledged: schema-init for certainty.* tables (assessment, call_record, fact_provenance, etc.). CREATE TABLE + CREATE INDEX in the same DDL batch against empty tables; locks are instantaneous. Future indexes MUST use CONCURRENTLY.
-- DECISION-011 — Bayesian certainty engine + AI Safety Doctrine v1.0
--
-- Adds:
--   certainty.assessment       — one row per finding-evaluation; canonical
--                                source for the posterior, the contributing
--                                components, and the adversarial outcome.
--   certainty.fact_provenance  — provenance roots per fact for the 5-source
--                                minimum rule + cluster-dependency check.
--   calibration.audit_run      — quarterly calibration audit artefact.
--   calibration.reliability_band — per-band predicted vs observed rates.
--   llm.prompt_template        — git-hashed, versioned prompts.
--   llm.call_record            — every Claude call (input/output hashes,
--                                model id, temperature, canary status).
--   llm.verbatim_audit_sample  — daily 5% verbatim audit sample.

CREATE SCHEMA IF NOT EXISTS certainty;
CREATE SCHEMA IF NOT EXISTS calibration;
CREATE SCHEMA IF NOT EXISTS llm;

-- 1. Certainty assessment per finding.
CREATE TABLE IF NOT EXISTS certainty.assessment (
  id                          uuid PRIMARY KEY,
  finding_id                  uuid NOT NULL,
  engine_version              text NOT NULL,
  prior_probability           numeric(6,5) NOT NULL,
  posterior_probability       numeric(6,5) NOT NULL,
  independent_source_count    integer NOT NULL,
  tier                        text NOT NULL,
  hold_reasons                text[] NOT NULL DEFAULT ARRAY[]::text[],
  adversarial                 jsonb NOT NULL,
  components                  jsonb NOT NULL,
  severity                    text NOT NULL,
  input_hash                  text NOT NULL,
  prompt_registry_hash        text NOT NULL,
  model_version               text NOT NULL,
  computed_at                 timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE certainty.assessment
  DROP CONSTRAINT IF EXISTS assessment_tier_check;
ALTER TABLE certainty.assessment
  ADD CONSTRAINT assessment_tier_check
  CHECK (tier IN ('action_queue','investigation_queue','log_only'));

ALTER TABLE certainty.assessment
  DROP CONSTRAINT IF EXISTS assessment_posterior_check;
ALTER TABLE certainty.assessment
  ADD CONSTRAINT assessment_posterior_check
  CHECK (posterior_probability >= 0 AND posterior_probability <= 1);

CREATE INDEX IF NOT EXISTS assessment_finding_idx
  ON certainty.assessment (finding_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS assessment_tier_idx
  ON certainty.assessment (tier, computed_at DESC);

-- 2. Provenance graph: each fact maps to its primary-source roots.
CREATE TABLE IF NOT EXISTS certainty.fact_provenance (
  fact_id           text NOT NULL,
  primary_source_id text NOT NULL,
  derivation_chain  text[] NOT NULL DEFAULT ARRAY[]::text[],
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fact_id, primary_source_id)
);

CREATE INDEX IF NOT EXISTS fact_provenance_source_idx
  ON certainty.fact_provenance (primary_source_id);

-- 3. Calibration audit run (quarterly per AI-SAFETY-DOCTRINE-v1 §2.6).
CREATE TABLE IF NOT EXISTS calibration.audit_run (
  id                       uuid PRIMARY KEY,
  period_label             text NOT NULL,
  period_start             timestamptz NOT NULL,
  period_end               timestamptz NOT NULL,
  engine_version           text NOT NULL,
  per_pattern_gap          jsonb NOT NULL DEFAULT '{}'::jsonb,
  anchor_audit_event_id    text,
  computed_at              timestamptz NOT NULL DEFAULT now(),
  signoff_architect        text,
  signoff_analyst          text,
  signoff_independent_reviewer text,
  CONSTRAINT audit_run_period_unique UNIQUE (period_label, engine_version)
);

CREATE INDEX IF NOT EXISTS audit_run_period_idx
  ON calibration.audit_run (period_start DESC);

-- 4. Reliability band (one row per band per audit run).
CREATE TABLE IF NOT EXISTS calibration.reliability_band (
  id                uuid PRIMARY KEY,
  audit_run_id      uuid NOT NULL REFERENCES calibration.audit_run(id) ON DELETE CASCADE,
  band_label        text NOT NULL,
  band_min          numeric(6,5) NOT NULL,
  band_max          numeric(6,5) NOT NULL,
  predicted_rate    numeric(6,5) NOT NULL,
  observed_rate     numeric(6,5) NOT NULL,
  finding_count     integer NOT NULL,
  cleared_count     integer NOT NULL,
  confirmed_count   integer NOT NULL,
  calibration_gap   numeric(6,5) NOT NULL,
  CONSTRAINT reliability_band_audit_label_unique UNIQUE (audit_run_id, band_label)
);

CREATE INDEX IF NOT EXISTS reliability_band_audit_idx
  ON calibration.reliability_band (audit_run_id);

-- 5. Prompt template registry (DECISION-011 §12).
CREATE TABLE IF NOT EXISTS llm.prompt_template (
  id            uuid PRIMARY KEY,
  name          text NOT NULL,
  version       text NOT NULL,
  template_hash text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  description   text NOT NULL DEFAULT '',
  active        boolean NOT NULL DEFAULT true,
  CONSTRAINT prompt_template_name_version_unique UNIQUE (name, version)
);

CREATE INDEX IF NOT EXISTS prompt_template_active_idx
  ON llm.prompt_template (active, name);

-- 6. LLM call record (DECISION-011 §1, §4, §13).
CREATE TABLE IF NOT EXISTS llm.call_record (
  id                   uuid PRIMARY KEY,
  finding_id           uuid,
  assessment_id        uuid,
  prompt_name          text NOT NULL,
  prompt_version       text NOT NULL,
  prompt_template_hash text NOT NULL,
  model_id             text NOT NULL,
  temperature          numeric(4,3) NOT NULL,
  input_hash           text NOT NULL,
  output_hash          text NOT NULL,
  canary_triggered     boolean NOT NULL DEFAULT false,
  schema_valid         boolean NOT NULL DEFAULT true,
  latency_ms           integer NOT NULL,
  cost_usd             numeric(10,6) NOT NULL DEFAULT 0,
  called_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_record_finding_idx
  ON llm.call_record (finding_id, called_at DESC);
CREATE INDEX IF NOT EXISTS call_record_canary_idx
  ON llm.call_record (canary_triggered, called_at DESC) WHERE canary_triggered = true;
CREATE INDEX IF NOT EXISTS call_record_invalid_idx
  ON llm.call_record (schema_valid, called_at DESC) WHERE schema_valid = false;

-- 7. Verbatim audit sample — 5% daily sampler output.
CREATE TABLE IF NOT EXISTS llm.verbatim_audit_sample (
  id            uuid PRIMARY KEY,
  call_record_id uuid REFERENCES llm.call_record(id) ON DELETE SET NULL,
  finding_id    uuid,
  claim         text NOT NULL,
  source_record_id text NOT NULL,
  verbatim_quote text NOT NULL,
  match_found   boolean NOT NULL,
  sampled_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verbatim_audit_match_idx
  ON llm.verbatim_audit_sample (match_found, sampled_at DESC);
