/**
 * Top-level extraction orchestrator.
 *
 * Composes:
 *   1. `extractDeterministically()` — regex/keyword pass (fires every time)
 *   2. `extractByLlm()` — Claude-via-SafeLlmRouter pass for fields the
 *      deterministic layer could not resolve. Optional; if no LLM call
 *      record sink is wired, the orchestrator returns deterministic-only.
 *
 * Returns the merged ProcurementFields plus full per-field provenance.
 *
 * Hardening:
 *   - LLM is NEVER called for safety-critical fields the deterministic
 *     layer already resolved. This keeps a model-provider compromise from
 *     overwriting verified extractions.
 *   - LLM output is schema-validated AND verbatim-grounded in the source
 *     text (per AI-SAFETY-DOCTRINE-v1 §B.1, §B.5) before its values are
 *     accepted into the merged result.
 *   - `mergePreferringDeterministic()` is a pure function — every output
 *     value can be traced back to a single (rule|llm_call) provenance.
 */

import { createHash } from 'node:crypto';

import { extractDeterministically, type DeterministicInput } from './deterministic.js';

import type { LlmExtractor, LlmExtractionResult } from './llm-extractor.js';
import type { Logger } from '@vigil/observability';
import type {
  ProcurementFields,
  ProcurementExtractionProvenance,
  ProcurementFieldKey,
  ExtractionFieldProvenance,
} from '@vigil/shared/schemas';

export interface ExtractorConfig {
  readonly extractorVersion: string;
  /** When unset, the orchestrator runs deterministic-only. */
  readonly llm: LlmExtractor | null;
  /** When unset, no LLM record id is captured (used in tests). */
  readonly now: () => Date;
  /**
   * Optional logger — when provided, LLM-fallback failures are logged as
   * structured `err_name`/`err_message` lines instead of being silently
   * swallowed. Tier-16 audit closure: graceful degradation is good policy
   * but observable degradation is better — operators couldn't previously
   * tell whether the LLM tier was healthy without inspecting the
   * call-record table directly.
   */
  readonly logger?: Logger;
}

export interface ExtractInput extends DeterministicInput {
  readonly findingId: string | null;
  readonly assessmentId: string | null;
}

export interface ExtractOutput {
  readonly fields: ProcurementFields;
  readonly provenance: ProcurementExtractionProvenance;
  readonly llm_was_called: boolean;
}

const EMPTY_FIELDS: ProcurementFields = {
  bidder_count: null,
  procurement_method: null,
  supplier_name: null,
  supplier_rccm: null,
  supplier_niu: null,
  amount_xaf: null,
  effective_date: null,
  award_date: null,
  tender_close_date: null,
  tender_publication_date: null,
  contracting_authority_name: null,
  region: null,
  has_escalation_clause: null,
  line_items: null,
  status_keywords: null,
};

export class ProcurementExtractor {
  constructor(private readonly cfg: ExtractorConfig) {}

  async extract(input: ExtractInput): Promise<ExtractOutput> {
    const inputJoin = [...input.cells, input.raw_text ?? ''].join(' · ');
    const inputSha = createHash('sha256').update(inputJoin).digest('hex');

    // Layer 1 — deterministic
    const det = extractDeterministically(input);

    // Layer 2 — LLM (optional, only for fields the deterministic layer missed)
    let llmResult: LlmExtractionResult | null = null;
    let llmWasCalled = false;
    if (this.cfg.llm !== null && det.unresolved.length > 0) {
      llmWasCalled = true;
      try {
        llmResult = await this.cfg.llm.extract({
          findingId: input.findingId,
          assessmentId: input.assessmentId,
          rawText: inputJoin,
          requestedFields: det.unresolved,
        });
      } catch (e) {
        // LLM failure is non-fatal — we already have the deterministic
        // result. Per AI-SAFETY-DOCTRINE §B.10, LLM-as-fallback means
        // the system degrades gracefully when the model is unavailable.
        // Tier-16 audit closure: log the failure so operators can see
        // LLM-tier health from logs instead of having to grep the
        // call-record table for missing entries.
        const err = e instanceof Error ? e : new Error(String(e));
        this.cfg.logger?.warn(
          {
            finding_id: input.findingId,
            assessment_id: input.assessmentId,
            unresolved_count: det.unresolved.length,
            err_name: err.name,
            err_message: err.message,
          },
          'extractor-llm-fallback-failed',
        );
        llmResult = null;
      }
    }

    // Merge — deterministic wins for any field both layers populate.
    const merged: ProcurementFields = { ...EMPTY_FIELDS };
    const provenance: Record<string, ExtractionFieldProvenance> = {};

    for (const k of Object.keys(EMPTY_FIELDS) as ProcurementFieldKey[]) {
      const detVal = det.fields[k];
      const detProv = det.provenance[k];
      if (detVal !== undefined && detProv !== undefined) {
        // Deterministic populated this field — accept verbatim.
        // TS narrowing: index signatures keep types loose; cast through unknown
        (merged as Record<string, unknown>)[k] = detVal as unknown;
        provenance[k] = detProv;
        continue;
      }
      const llmVal = llmResult?.fields[k];
      const llmProv = llmResult?.provenance[k];
      if (llmVal !== undefined && llmProv !== undefined && llmVal !== null) {
        (merged as Record<string, unknown>)[k] = llmVal as unknown;
        provenance[k] = llmProv;
      }
    }

    return {
      fields: merged,
      provenance: {
        extracted_at: this.cfg.now().toISOString(),
        extractor_version: this.cfg.extractorVersion,
        fields: provenance,
        llm_call_record_id: llmResult?.callRecordId ?? null,
        input_sha256: inputSha,
      },
      llm_was_called: llmWasCalled,
    };
  }
}
