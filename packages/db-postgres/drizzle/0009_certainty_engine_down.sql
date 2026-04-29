-- Rollback DECISION-011 forward migration. Destructive — dev only.
DROP TABLE IF EXISTS llm.verbatim_audit_sample;
DROP TABLE IF EXISTS llm.call_record;
DROP TABLE IF EXISTS llm.prompt_template;
DROP TABLE IF EXISTS calibration.reliability_band;
DROP TABLE IF EXISTS calibration.audit_run;
DROP TABLE IF EXISTS certainty.fact_provenance;
DROP TABLE IF EXISTS certainty.assessment;
DROP SCHEMA IF EXISTS llm CASCADE;
DROP SCHEMA IF EXISTS calibration CASCADE;
DROP SCHEMA IF EXISTS certainty CASCADE;
