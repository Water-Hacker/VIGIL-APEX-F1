/**
 * LLM-based extractor. Uses SafeLlmRouter (DECISION-011) for closed-context
 * rendering, daily canary, citation enforcement, prompt versioning, and
 * temperature pinning. Only called for fields the deterministic layer
 * could not resolve (cost + tamper-resistance).
 *
 * Returns: per-field values + per-field provenance pointing to the LLM
 * call_record. Verbatim grounding is enforced — if the model claims a
 * value but its accompanying quote does not appear in the source text,
 * that field is rejected (provenance is omitted, value falls through to
 * null).
 */

import { z } from 'zod';

import type {
  ProcurementFields,
  ProcurementFieldKey,
  ExtractionFieldProvenance,
} from '@vigil/shared/schemas';

import './prompts.js'; // side-effect: register procurement.extract-fields

export interface LlmExtractorRequest {
  readonly findingId: string | null;
  readonly assessmentId: string | null;
  readonly rawText: string;
  readonly requestedFields: ReadonlyArray<ProcurementFieldKey>;
}

export interface LlmExtractionResult {
  readonly fields: Partial<ProcurementFields>;
  readonly provenance: Partial<Record<ProcurementFieldKey, ExtractionFieldProvenance>>;
  readonly callRecordId: string | null;
}

export interface LlmExtractor {
  extract(req: LlmExtractorRequest): Promise<LlmExtractionResult>;
}

/**
 * Schema the LLM is forced to produce. Every field is paired with a
 * verbatim quote that the orchestrator validates against the source text
 * before accepting the value.
 */
const zLlmExtractionItem = z.object({
  field: z.enum([
    'bidder_count',
    'procurement_method',
    'supplier_name',
    'supplier_rccm',
    'supplier_niu',
    'amount_xaf',
    'effective_date',
    'award_date',
    'tender_close_date',
    'tender_publication_date',
    'contracting_authority_name',
    'region',
    'has_escalation_clause',
  ]),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
  /** Verbatim substring of the raw text that supports this value. */
  verbatim_quote: z.string().min(1).max(800),
  /** Confidence the LLM assigns; we discount it before accepting. */
  llm_confidence: z.number().min(0).max(1),
});

const zLlmExtractionResponse = z.object({
  status: z.enum(['ok', 'insufficient_evidence']),
  items: z.array(zLlmExtractionItem).max(20),
});

export type LlmExtractionResponse = z.infer<typeof zLlmExtractionResponse>;

/**
 * SafeLlmRouter shape — minimal interface so this package doesn't pull
 * `@vigil/llm` directly into its public surface.
 */
export interface SafeLlmRouterLike {
  call<TResult>(input: {
    findingId: string | null;
    assessmentId: string | null;
    promptName: string;
    task: string;
    sources: ReadonlyArray<{ id: string; label?: string; text: string }>;
    responseSchema: z.ZodType<TResult>;
    modelId: string;
    temperature: number;
  }): Promise<{ value: TResult; callRecordId: string | null }>;
}

const PROMPT_NAME = 'procurement.extract-fields';
const MODEL_ID = 'claude-haiku-4-5-20251001';
const TEMPERATURE = 0.0; // SRD §20: extraction = 0.0
const MIN_CONFIDENCE_TO_ACCEPT = 0.6;

/**
 * Tier-61 audit closure — surface input truncation so operators know
 * whether the LLM extracted from the full document or just the first
 * 50k chars. Pre-fix the slice was silent: a 200k-char document was
 * extracted from only its first quarter, producing "no value found"
 * for fields buried deeper. Operators saw the extraction outcome but
 * not the truncation, blaming the LLM for a budget-imposed blind spot.
 *
 * 50k is the established cap; we keep it (matches the worker-tip-triage
 * 4k paraphrase budget pattern) but emit the warning via the optional
 * logger so callers can route it.
 */
const RAW_TEXT_BUDGET_CHARS = 50_000;

export interface SafeLlmExtractorOptions {
  readonly logger?: {
    warn(obj: Record<string, unknown>, msg: string): void;
  };
}

export class SafeLlmExtractor implements LlmExtractor {
  constructor(
    private readonly router: SafeLlmRouterLike,
    private readonly opts: SafeLlmExtractorOptions = {},
  ) {}

  async extract(req: LlmExtractorRequest): Promise<LlmExtractionResult> {
    const requestedList = req.requestedFields.join(', ');
    const task =
      `Extract these procurement fields from the listing text below: ${requestedList}.\n` +
      'For each value you find, return one item with {field, value, verbatim_quote, llm_confidence}. ' +
      'verbatim_quote MUST be a substring of the listing — do not paraphrase, do not translate. ' +
      'If the listing does not contain a value for a field, omit that field. ' +
      'If you cannot answer from the provided source, return {"status":"insufficient_evidence","items":[]}.';

    // Tier-61: surface truncation before the call.
    const truncated = req.rawText.length > RAW_TEXT_BUDGET_CHARS;
    if (truncated) {
      this.opts.logger?.warn(
        {
          finding_id: req.findingId,
          assessment_id: req.assessmentId,
          full_length: req.rawText.length,
          budget: RAW_TEXT_BUDGET_CHARS,
          dropped: req.rawText.length - RAW_TEXT_BUDGET_CHARS,
        },
        'llm-extractor-raw-text-truncated',
      );
    }
    const sources = [
      {
        id: 'listing',
        label: 'procurement listing',
        text: truncated ? req.rawText.slice(0, RAW_TEXT_BUDGET_CHARS) : req.rawText,
      },
    ];
    const result = await this.router.call({
      findingId: req.findingId,
      assessmentId: req.assessmentId,
      promptName: PROMPT_NAME,
      task,
      sources,
      responseSchema: zLlmExtractionResponse,
      modelId: MODEL_ID,
      temperature: TEMPERATURE,
    });

    const fields: Partial<ProcurementFields> = {};
    const provenance: Partial<Record<ProcurementFieldKey, ExtractionFieldProvenance>> = {};

    if (result.value.status === 'insufficient_evidence') {
      return { fields, provenance, callRecordId: result.callRecordId };
    }

    for (const item of result.value.items) {
      // Drop low-confidence claims
      if (item.llm_confidence < MIN_CONFIDENCE_TO_ACCEPT) continue;
      // Verbatim grounding — quote must appear in the raw text
      if (!req.rawText.includes(item.verbatim_quote)) continue;
      // Drop fields not in the requested set (no scope creep)
      if (!req.requestedFields.includes(item.field as ProcurementFieldKey)) continue;
      // Drop nulls — caller treats absence as absence
      if (item.value === null) continue;

      const accepted = coerceValue(item.field as ProcurementFieldKey, item.value);
      if (accepted === undefined) continue;
      (fields as Record<string, unknown>)[item.field] = accepted;
      provenance[item.field as ProcurementFieldKey] = {
        method: 'llm',
        detail: result.callRecordId ?? 'no-call-record',
        confidence: item.llm_confidence,
      };
    }

    return { fields, provenance, callRecordId: result.callRecordId };
  }
}

/**
 * Coerce LLM-returned value to the canonical type for the field.
 * Returns `undefined` to mean "rejected — type didn't match".
 */
function coerceValue(field: ProcurementFieldKey, raw: string | number | boolean): unknown {
  switch (field) {
    case 'bidder_count': {
      const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
      if (!Number.isFinite(n) || n < 0 || n > 1000) return undefined;
      return Math.trunc(n);
    }
    case 'amount_xaf': {
      const n =
        typeof raw === 'number' ? raw : Number.parseFloat(String(raw).replace(/[\s,]/g, ''));
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000_000) return undefined;
      return Math.round(n);
    }
    case 'has_escalation_clause': {
      if (typeof raw === 'boolean') return raw;
      const s = String(raw).toLowerCase();
      if (s === 'true' || s === 'oui' || s === 'yes') return true;
      if (s === 'false' || s === 'non' || s === 'no') return false;
      return undefined;
    }
    case 'effective_date':
    case 'award_date':
    case 'tender_close_date':
    case 'tender_publication_date': {
      const s = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
      return s;
    }
    case 'procurement_method': {
      const allowed = [
        'appel_offres_ouvert',
        'appel_offres_restreint',
        'gre_a_gre',
        'marche_negocie',
        'consultation_simplifie',
        'concours',
        'unknown',
      ];
      const s = String(raw)
        .toLowerCase()
        .replace(/[\s'-]/g, '_');
      return allowed.includes(s) ? s : undefined;
    }
    default: {
      // String fields — clamp length, reject empty
      const s = String(raw).trim();
      if (s.length === 0 || s.length > 500) return undefined;
      return s;
    }
  }
}
