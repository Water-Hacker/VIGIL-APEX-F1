import { z } from 'zod';

/**
 * AI-SAFETY-DOCTRINE-v1 Failure Mode 1 — strict source-grounding.
 *
 * Every claim Claude produces in an extraction or evaluation call MUST
 * carry a (claim, source_record_id, source_field, verbatim_quote) tuple.
 * Schema validation rejects free-form prose. Verbatim grounding rejects
 * any quote that does not appear in the cited source record.
 */

export const zCitedClaim = z.object({
  claim: z.string().min(1).max(2_000),
  source_record_id: z.string().min(1).max(200),
  source_field: z.string().min(1).max(120),
  verbatim_quote: z.string().min(1).max(2_000),
});
export type CitedClaim = z.infer<typeof zCitedClaim>;

export const zCitedExtraction = z.object({
  status: z.enum(['ok', 'insufficient_evidence']),
  claims: z.array(zCitedClaim).default([]),
  /** Optional rationale describing what the model did. Bounded length to
   *  discourage narrative hallucinations. */
  reasoning_trace: z.string().max(2_000).optional(),
});
export type CitedExtraction = z.infer<typeof zCitedExtraction>;

export interface SourceRecordIndex {
  /** Returns the raw text of a (record_id, field_name) tuple, or null if no
   *  such record/field exists. The verbatim grounding validator searches
   *  this text for the model's claimed quote. */
  fieldText(recordId: string, field: string): string | null;
}

export interface VerbatimValidationOutcome {
  readonly grounded: ReadonlyArray<CitedClaim>;
  readonly rejected: ReadonlyArray<{ claim: CitedClaim; reason: string }>;
}

const NORMALISE_RE = /\s+/g;

function normalise(s: string): string {
  return s.normalize('NFKC').replace(NORMALISE_RE, ' ').trim().toLowerCase();
}

/**
 * Validates that every claim's verbatim_quote actually appears in the
 * cited source record. Whitespace + unicode normalisation are applied
 * symmetrically so cosmetic differences (smart quotes, line breaks) don't
 * cause false rejections. If the source record / field is unknown, the
 * claim is rejected.
 */
export function validateVerbatimGrounding(
  extraction: CitedExtraction,
  sources: SourceRecordIndex,
): VerbatimValidationOutcome {
  const grounded: CitedClaim[] = [];
  const rejected: Array<{ claim: CitedClaim; reason: string }> = [];
  for (const c of extraction.claims) {
    const fieldText = sources.fieldText(c.source_record_id, c.source_field);
    if (fieldText === null) {
      rejected.push({ claim: c, reason: 'source-record-or-field-not-found' });
      continue;
    }
    const haystack = normalise(fieldText);
    const needle = normalise(c.verbatim_quote);
    if (needle.length === 0) {
      rejected.push({ claim: c, reason: 'empty-quote' });
      continue;
    }
    if (!haystack.includes(needle)) {
      rejected.push({ claim: c, reason: 'quote-not-in-source-field' });
      continue;
    }
    grounded.push(c);
  }
  return { grounded, rejected };
}
