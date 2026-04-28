-- 0005_adapter_repair.sql — Phase H7.
--
-- Tables backing worker-adapter-repair (W-19 self-healing).
--
-- proposal: an LLM-generated candidate selector waiting for shadow
-- testing or architect approval. Critical adapters (armp-main,
-- dgi-attestations, cour-des-comptes) require manual approve;
-- informational ones auto-promote when shadow_log shows
-- mismatch < 5% over 48 windows.
--
-- shadow_log: one row per shadow-test cycle (hourly during the 48 h
-- window). The auto-promotion rule reads from here.

CREATE TABLE IF NOT EXISTS source.adapter_repair_proposal (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          TEXT         NOT NULL,
  candidate_selector JSONB        NOT NULL,
  rationale          TEXT,
  generated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  generated_by_llm   TEXT         NOT NULL, -- e.g. 'anthropic:claude-opus-4-7'
  status             TEXT         NOT NULL DEFAULT 'shadow_testing',
                                   -- shadow_testing | awaiting_approval | promoted | rejected | superseded
  decided_at         TIMESTAMPTZ,
  decided_by         TEXT,
  decision_reason    TEXT
);

CREATE INDEX IF NOT EXISTS adapter_repair_proposal_source_idx
  ON source.adapter_repair_proposal (source_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS adapter_repair_proposal_status_idx
  ON source.adapter_repair_proposal (status)
  WHERE status IN ('shadow_testing', 'awaiting_approval');

CREATE TABLE IF NOT EXISTS source.adapter_repair_shadow_log (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  UUID         NOT NULL REFERENCES source.adapter_repair_proposal(id) ON DELETE CASCADE,
  ran_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  old_match    BOOLEAN      NOT NULL,  -- did the live page parse with the old selector?
  new_match    BOOLEAN      NOT NULL,  -- did it parse with the new selector?
  divergence   BOOLEAN      NOT NULL,  -- did the two selectors disagree on extracted output?
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS adapter_repair_shadow_proposal_idx
  ON source.adapter_repair_shadow_log (proposal_id, ran_at DESC);

-- adapter_selector_registry: the live selector each adapter uses. The
-- adapter-runner UPSERTs this on every successful first-contact so
-- worker-adapter-repair can read the current selector + expected
-- field set without scraping adapter source code.
CREATE TABLE IF NOT EXISTS source.adapter_selector_registry (
  source_id        TEXT         PRIMARY KEY,
  primary_url      TEXT         NOT NULL,
  selector         JSONB        NOT NULL,
  expected_fields  TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by       TEXT         NOT NULL DEFAULT 'adapter-runner'
);
