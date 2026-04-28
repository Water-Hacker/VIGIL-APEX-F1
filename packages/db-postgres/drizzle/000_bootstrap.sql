-- VIGIL APEX — bootstrap migration
-- SRD §07.2. Sets up extensions, schemas, RLS, and the audit hash-chain trigger.

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS unaccent;
-- pgvector is loaded by the dedicated pgvector image; if running on a vanilla pg image:
-- CREATE EXTENSION IF NOT EXISTS vector;

-- Schemas (Drizzle creates tables; we ensure schemas exist first)
CREATE SCHEMA IF NOT EXISTS source;
CREATE SCHEMA IF NOT EXISTS entity;
CREATE SCHEMA IF NOT EXISTS finding;
CREATE SCHEMA IF NOT EXISTS dossier;
CREATE SCHEMA IF NOT EXISTS governance;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS tip;
CREATE SCHEMA IF NOT EXISTS calibration;

-- Roles per SRD §17.12 (least-privilege)
DO $$ BEGIN
  CREATE ROLE vigil_operator NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE vigil_tip_handler NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE vigil_auditor NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE vigil_worker NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE vigil_public NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Default privileges — workers full on their domain, operators full on dashboard data,
-- tip handlers ONLY on tip schema, auditors read-only.
GRANT USAGE ON SCHEMA source, entity, finding, dossier, governance, audit, tip, calibration TO vigil_worker;
GRANT USAGE ON SCHEMA source, entity, finding, dossier, governance, audit, calibration TO vigil_operator;
GRANT USAGE ON SCHEMA tip TO vigil_tip_handler;
GRANT USAGE ON SCHEMA source, entity, finding, dossier, governance, audit, calibration TO vigil_auditor;

-- Tip handlers cannot read calibration (operational confidentiality, EXEC §24.3)
REVOKE ALL ON SCHEMA calibration FROM vigil_tip_handler;

-- Public surface — only ledger and verify aggregates
GRANT USAGE ON SCHEMA audit TO vigil_public;
