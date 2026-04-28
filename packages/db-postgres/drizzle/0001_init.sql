-- VIGIL APEX — initial DDL (post-bootstrap).
-- Mirrors the Drizzle schema in `packages/db-postgres/src/schema/`.
--
-- Every CREATE is `IF NOT EXISTS` so the migration is rerunnable. Forward-only;
-- to revert, write a new migration that undoes (per SRD §07.1).
--
-- Order:
--   1. Tables (per schema)
--   2. Indexes (per table)
--   3. Triggers (audit hash-chain integrity + dossier seq)
--   4. Row-level security on `tip` and `calibration`

-- =============================================================================
-- source.events — adapter outputs
-- =============================================================================
CREATE TABLE IF NOT EXISTS source.events (
  id            UUID PRIMARY KEY,
  source_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,
  dedup_key     TEXT NOT NULL,
  published_at  TIMESTAMPTZ,
  observed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload       JSONB NOT NULL,
  document_cids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  provenance    JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_dedup_unique UNIQUE (source_id, dedup_key)
);
CREATE INDEX IF NOT EXISTS events_source_idx ON source.events (source_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS events_kind_idx ON source.events (kind);

-- =============================================================================
-- source.documents — fetched binary artefacts
-- =============================================================================
CREATE TABLE IF NOT EXISTS source.documents (
  id                   UUID PRIMARY KEY,
  cid                  TEXT NOT NULL,
  source_id            TEXT NOT NULL,
  kind                 TEXT NOT NULL,
  mime                 TEXT NOT NULL,
  language             TEXT NOT NULL,
  bytes                BIGINT NOT NULL,
  sha256               TEXT NOT NULL,
  source_url           TEXT,
  fetched_at           TIMESTAMPTZ NOT NULL,
  ocr_engine           TEXT NOT NULL DEFAULT 'none',
  ocr_confidence       TEXT,
  text_extract_chars   INTEGER,
  pinned_at_ipfs       BOOLEAN NOT NULL DEFAULT FALSE,
  mirrored_to_synology BOOLEAN NOT NULL DEFAULT FALSE,
  metadata             JSONB NOT NULL DEFAULT '{}'::JSONB,
  CONSTRAINT documents_sha256_unique UNIQUE (sha256)
);
CREATE INDEX IF NOT EXISTS documents_cid_idx ON source.documents (cid);

-- =============================================================================
-- source.proxy_pool — proxy inventory
-- =============================================================================
CREATE TABLE IF NOT EXISTS source.proxy_pool (
  id              UUID PRIMARY KEY,
  provider        TEXT NOT NULL,
  endpoint        TEXT NOT NULL,
  region          TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  cooldown_until  TIMESTAMPTZ,
  failures_24h    INTEGER NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMPTZ
);

-- =============================================================================
-- source.adapter_health
-- =============================================================================
CREATE TABLE IF NOT EXISTS source.adapter_health (
  source_id            TEXT PRIMARY KEY,
  status               TEXT NOT NULL,
  last_run_at          TIMESTAMPTZ,
  last_success_at      TIMESTAMPTZ,
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  rows_in_last_run     INTEGER,
  next_scheduled_at    TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- source.robots — robots.txt snapshots
-- =============================================================================
CREATE TABLE IF NOT EXISTS source.robots (
  source_id    TEXT PRIMARY KEY,
  user_agent   TEXT NOT NULL,
  body         TEXT NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL
);

-- =============================================================================
-- source.dead_letter — DLQ rows
-- =============================================================================
CREATE TABLE IF NOT EXISTS source.dead_letter (
  id              UUID PRIMARY KEY,
  source_id       TEXT,
  worker          TEXT NOT NULL,
  error_class     TEXT NOT NULL,
  payload         JSONB NOT NULL,
  reason          TEXT NOT NULL,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_reason TEXT
);

-- =============================================================================
-- entity.canonical
-- =============================================================================
CREATE TABLE IF NOT EXISTS entity.canonical (
  id                    UUID PRIMARY KEY,
  kind                  TEXT NOT NULL,
  display_name          TEXT NOT NULL,
  rccm_number           TEXT,
  niu                   TEXT,
  jurisdiction          TEXT,
  region                TEXT,
  eth_address           TEXT,
  is_pep                BOOLEAN NOT NULL DEFAULT FALSE,
  is_sanctioned         BOOLEAN NOT NULL DEFAULT FALSE,
  sanctioned_lists      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  first_seen            TIMESTAMPTZ NOT NULL,
  last_seen             TIMESTAMPTZ NOT NULL,
  resolution_confidence DOUBLE PRECISION NOT NULL,
  resolved_by           TEXT NOT NULL,
  metadata              JSONB NOT NULL DEFAULT '{}'::JSONB
);
CREATE INDEX IF NOT EXISTS canonical_rccm_idx ON entity.canonical (rccm_number) WHERE rccm_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS canonical_niu_idx ON entity.canonical (niu) WHERE niu IS NOT NULL;
CREATE INDEX IF NOT EXISTS canonical_pep_idx ON entity.canonical (is_pep, is_sanctioned);
CREATE INDEX IF NOT EXISTS canonical_name_trgm ON entity.canonical USING gin (display_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS entity.alias (
  id            UUID PRIMARY KEY,
  canonical_id  UUID NOT NULL,
  alias         TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  language      TEXT NOT NULL,
  first_seen    TIMESTAMPTZ NOT NULL,
  CONSTRAINT alias_unique UNIQUE (canonical_id, alias, source_id)
);
CREATE INDEX IF NOT EXISTS alias_canonical_idx ON entity.alias (canonical_id);
CREATE INDEX IF NOT EXISTS alias_alias_idx ON entity.alias (alias);

CREATE TABLE IF NOT EXISTS entity.relationship (
  id                  UUID PRIMARY KEY,
  kind                TEXT NOT NULL,
  from_canonical_id   UUID NOT NULL,
  to_canonical_id     UUID NOT NULL,
  evidence_strength   DOUBLE PRECISION NOT NULL,
  source_event_ids    UUID[] NOT NULL,
  first_seen          TIMESTAMPTZ NOT NULL,
  last_seen           TIMESTAMPTZ NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::JSONB
);
CREATE INDEX IF NOT EXISTS relationship_from_kind_idx ON entity.relationship (from_canonical_id, kind);
CREATE INDEX IF NOT EXISTS relationship_to_idx ON entity.relationship (to_canonical_id);

CREATE TABLE IF NOT EXISTS entity.er_review_queue (
  id                       UUID PRIMARY KEY,
  candidate_a              UUID NOT NULL,
  candidate_b              UUID NOT NULL,
  similarity               DOUBLE PRECISION NOT NULL,
  proposed_action          TEXT NOT NULL,
  rationale                TEXT NOT NULL,
  decided_at               TIMESTAMPTZ,
  decided_by               TEXT,
  decision                 TEXT
);

-- =============================================================================
-- finding.finding + signal
-- =============================================================================
CREATE TABLE IF NOT EXISTS finding.finding (
  id                          UUID PRIMARY KEY,
  state                       TEXT NOT NULL DEFAULT 'detected',
  primary_entity_id           UUID,
  related_entity_ids          UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  amount_xaf                  BIGINT,
  region                      TEXT,
  severity                    TEXT NOT NULL DEFAULT 'low',
  posterior                   DOUBLE PRECISION,
  signal_count                INTEGER NOT NULL DEFAULT 0,
  title_fr                    TEXT NOT NULL,
  title_en                    TEXT NOT NULL,
  summary_fr                  TEXT NOT NULL,
  summary_en                  TEXT NOT NULL,
  counter_evidence            TEXT,
  detected_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_signal_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  council_proposal_index      TEXT,
  council_voted_at            TIMESTAMPTZ,
  council_yes_votes           INTEGER NOT NULL DEFAULT 0,
  council_no_votes            INTEGER NOT NULL DEFAULT 0,
  council_recused_addresses   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  closed_at                   TIMESTAMPTZ,
  closure_reason              TEXT
);
CREATE INDEX IF NOT EXISTS finding_state_idx ON finding.finding (state);
CREATE INDEX IF NOT EXISTS finding_primary_entity_idx ON finding.finding (primary_entity_id);
-- D2 (Phase D adds the composite index): pre-create here to avoid a later migration
CREATE INDEX IF NOT EXISTS finding_state_posterior_detected_idx
  ON finding.finding (state, posterior DESC NULLS LAST, detected_at DESC)
  WHERE state IN ('detected','review','council_review','escalated');

CREATE TABLE IF NOT EXISTS finding.signal (
  id                       UUID PRIMARY KEY,
  finding_id               UUID NOT NULL,
  source                   TEXT NOT NULL,
  pattern_id               TEXT,
  strength                 DOUBLE PRECISION NOT NULL,
  prior                    DOUBLE PRECISION NOT NULL,
  weight                   DOUBLE PRECISION NOT NULL,
  evidence_event_ids       UUID[] NOT NULL,
  evidence_document_cids   TEXT[] NOT NULL,
  contributed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata                 JSONB NOT NULL DEFAULT '{}'::JSONB
);
CREATE INDEX IF NOT EXISTS signal_finding_idx ON finding.signal (finding_id);
CREATE INDEX IF NOT EXISTS signal_pattern_idx ON finding.signal (pattern_id);

-- =============================================================================
-- dossier.dossier + referral + sequence
-- =============================================================================
CREATE TABLE IF NOT EXISTS dossier.dossier (
  id                         UUID PRIMARY KEY,
  ref                        TEXT NOT NULL,
  finding_id                 UUID NOT NULL,
  language                   TEXT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'rendered',
  pdf_sha256                 TEXT NOT NULL,
  pdf_cid                    TEXT,
  signature_fingerprint      TEXT,
  signature_at               TIMESTAMPTZ,
  rendered_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at               TIMESTAMPTZ,
  acknowledged_at            TIMESTAMPTZ,
  recipient_case_reference   TEXT,
  manifest_hash              TEXT,
  metadata                   JSONB NOT NULL DEFAULT '{}'::JSONB,
  CONSTRAINT dossier_ref_unique UNIQUE (ref, language)
);

CREATE TABLE IF NOT EXISTS dossier.referral (
  id                       UUID PRIMARY KEY,
  dossier_id               UUID NOT NULL,
  channel                  TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending',
  attempts                 INTEGER NOT NULL DEFAULT 0,
  last_attempt_at          TIMESTAMPTZ,
  ack_received_at          TIMESTAMPTZ,
  ack_payload              JSONB,
  format_adapter_version   TEXT NOT NULL DEFAULT 'v1'
);

CREATE TABLE IF NOT EXISTS dossier.dossier_sequence (
  year     INTEGER PRIMARY KEY,
  next_seq BIGINT NOT NULL DEFAULT 1
);

-- =============================================================================
-- governance.member + proposal + vote
-- =============================================================================
CREATE TABLE IF NOT EXISTS governance.member (
  id              UUID PRIMARY KEY,
  pillar          TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  eth_address     TEXT NOT NULL,
  yubikey_serial  TEXT,
  yubikey_aaguid  TEXT,
  enrolled_at     TIMESTAMPTZ NOT NULL,
  resigned_at     TIMESTAMPTZ,
  bio_fr          TEXT NOT NULL,
  bio_en          TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT member_address_unique UNIQUE (eth_address)
);
CREATE INDEX IF NOT EXISTS member_active_idx ON governance.member (is_active, pillar);

CREATE TABLE IF NOT EXISTS governance.proposal (
  id                 UUID PRIMARY KEY,
  on_chain_index     TEXT NOT NULL,
  finding_id         UUID NOT NULL,
  dossier_id         UUID,
  state              TEXT NOT NULL DEFAULT 'open',
  opened_at          TIMESTAMPTZ NOT NULL,
  closes_at          TIMESTAMPTZ NOT NULL,
  closed_at          TIMESTAMPTZ,
  yes_votes          INTEGER NOT NULL DEFAULT 0,
  no_votes           INTEGER NOT NULL DEFAULT 0,
  abstain_votes      INTEGER NOT NULL DEFAULT 0,
  recuse_votes       INTEGER NOT NULL DEFAULT 0,
  proposal_tx_hash   TEXT,
  closing_tx_hash    TEXT,
  CONSTRAINT proposal_chain_unique UNIQUE (on_chain_index)
);

CREATE TABLE IF NOT EXISTS governance.vote (
  id              UUID PRIMARY KEY,
  proposal_id     UUID NOT NULL,
  voter_address   TEXT NOT NULL,
  voter_pillar    TEXT NOT NULL,
  choice          TEXT NOT NULL,
  cast_at         TIMESTAMPTZ NOT NULL,
  vote_tx_hash    TEXT NOT NULL,
  recuse_reason   TEXT,
  CONSTRAINT vote_unique_per_proposal UNIQUE (proposal_id, voter_address)
);

-- =============================================================================
-- audit.actions — hash-chained, tamper-evident
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit.actions (
  id            UUID PRIMARY KEY,
  seq           BIGINT NOT NULL,
  action        TEXT NOT NULL,
  actor         TEXT NOT NULL,
  subject_kind  TEXT NOT NULL,
  subject_id    TEXT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  payload       JSONB NOT NULL,
  prev_hash     BYTEA,
  body_hash     BYTEA NOT NULL,
  inserted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT actions_seq_unique UNIQUE (seq)
);
CREATE INDEX IF NOT EXISTS actions_action_idx ON audit.actions (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS actions_subject_idx ON audit.actions (subject_kind, subject_id);

CREATE TABLE IF NOT EXISTS audit.anchor_commitment (
  id                     UUID PRIMARY KEY,
  seq_from               BIGINT NOT NULL,
  seq_to                 BIGINT NOT NULL,
  root_hash              BYTEA NOT NULL,
  committed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  polygon_tx_hash        TEXT,
  polygon_block_number   BIGINT,
  polygon_confirmed_at   TIMESTAMPTZ
);

-- =============================================================================
-- tip.tip + sequence
-- =============================================================================
CREATE TABLE IF NOT EXISTS tip.tip (
  id                         UUID PRIMARY KEY,
  ref                        TEXT NOT NULL,
  disposition                TEXT NOT NULL DEFAULT 'NEW',
  body_ciphertext            BYTEA NOT NULL,
  contact_ciphertext         BYTEA,
  attachment_cids            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  topic_hint                 TEXT,
  region                     TEXT,
  received_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triaged_at                 TIMESTAMPTZ,
  triaged_by                 TEXT,
  promoted_finding_id        UUID,
  triage_notes_ciphertext    BYTEA,
  CONSTRAINT tip_ref_unique UNIQUE (ref)
);
CREATE INDEX IF NOT EXISTS tip_disposition_idx ON tip.tip (disposition, received_at DESC);

CREATE TABLE IF NOT EXISTS tip.tip_sequence (
  year     TEXT PRIMARY KEY,
  next_seq TEXT NOT NULL
);

-- =============================================================================
-- calibration.entry + report
-- =============================================================================
CREATE TABLE IF NOT EXISTS calibration.entry (
  id                            UUID PRIMARY KEY,
  recorded_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pattern_id                    TEXT NOT NULL,
  finding_id                    UUID NOT NULL,
  case_label                    TEXT NOT NULL,
  case_year                     INTEGER NOT NULL,
  region                        TEXT,
  amount_xaf                    BIGINT,
  posterior_at_review           DOUBLE PRECISION NOT NULL,
  severity_at_review            TEXT NOT NULL,
  ground_truth                  TEXT NOT NULL DEFAULT 'pending',
  ground_truth_recorded_by      TEXT NOT NULL,
  ground_truth_evidence         JSONB NOT NULL,
  closure_reason                TEXT,
  notes                         TEXT NOT NULL DEFAULT '',
  redacted                      BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS entry_pattern_idx ON calibration.entry (pattern_id);
CREATE INDEX IF NOT EXISTS entry_truth_idx ON calibration.entry (ground_truth, recorded_at DESC);

CREATE TABLE IF NOT EXISTS calibration.report (
  id              UUID PRIMARY KEY,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_days     INTEGER NOT NULL,
  total_entries   INTEGER NOT NULL,
  graded_entries  INTEGER NOT NULL,
  ece_overall     DOUBLE PRECISION NOT NULL,
  brier_overall   DOUBLE PRECISION NOT NULL,
  per_pattern     JSONB NOT NULL
);

-- =============================================================================
-- audit.actions — tamper-evidence trigger
-- =============================================================================
-- The trigger ensures that no INSERT bypasses the hash-chain wrapper. Application
-- code MUST go through @vigil/audit-chain HashChain.append() which fills both
-- prev_hash and body_hash. This trigger only enforces that body_hash is set and
-- that no UPDATE/DELETE is permitted.

CREATE OR REPLACE FUNCTION audit.actions_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'audit.actions is append-only; %s blocked', TG_OP;
  END IF;
  IF NEW.body_hash IS NULL OR length(NEW.body_hash) <> 32 THEN
    RAISE EXCEPTION 'audit.actions.body_hash must be a 32-byte sha256 digest';
  END IF;
  IF NEW.prev_hash IS NOT NULL AND length(NEW.prev_hash) <> 32 THEN
    RAISE EXCEPTION 'audit.actions.prev_hash must be NULL or a 32-byte digest';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_actions_immutable ON audit.actions;
CREATE TRIGGER audit_actions_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON audit.actions
  FOR EACH ROW EXECUTE FUNCTION audit.actions_immutable();

-- =============================================================================
-- dossier.dossier_sequence — atomic UPSERT-INCR helper
-- =============================================================================
CREATE OR REPLACE FUNCTION dossier.next_seq(year_in INTEGER)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  INSERT INTO dossier.dossier_sequence (year, next_seq)
    VALUES (year_in, 2)
    ON CONFLICT (year) DO UPDATE
      SET next_seq = dossier.dossier_sequence.next_seq + 1
    RETURNING next_seq INTO v_seq;
  RETURN v_seq - 1;
END;
$$;

-- =============================================================================
-- Row-Level Security
-- =============================================================================
-- tip schema: tip_handlers + auditors only; the public role has no read access
ALTER TABLE tip.tip ENABLE ROW LEVEL SECURITY;
CREATE POLICY tip_handler_all ON tip.tip
  TO vigil_tip_handler
  USING (TRUE)
  WITH CHECK (TRUE);
CREATE POLICY tip_auditor_read ON tip.tip
  TO vigil_auditor
  USING (TRUE);

-- calibration schema: operators read; tip_handlers DENIED (EXEC §24.3)
ALTER TABLE calibration.entry ENABLE ROW LEVEL SECURITY;
CREATE POLICY calibration_operator_read ON calibration.entry
  TO vigil_operator
  USING (TRUE);
CREATE POLICY calibration_auditor_read ON calibration.entry
  TO vigil_auditor
  USING (TRUE);
CREATE POLICY calibration_worker_write ON calibration.entry
  TO vigil_worker
  USING (TRUE)
  WITH CHECK (TRUE);

-- =============================================================================
-- Grants on the schemas
-- =============================================================================
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA source, entity, finding, dossier, governance, audit, tip, calibration TO vigil_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA source, entity, finding, dossier, governance, audit, calibration TO vigil_operator;
GRANT SELECT ON ALL TABLES IN SCHEMA source, entity, finding, dossier, governance, audit, calibration TO vigil_auditor;
GRANT SELECT, INSERT, UPDATE ON tip.tip TO vigil_tip_handler;

ALTER DEFAULT PRIVILEGES IN SCHEMA source, entity, finding, dossier, governance, audit, tip, calibration
  GRANT SELECT, INSERT, UPDATE ON TABLES TO vigil_worker;
