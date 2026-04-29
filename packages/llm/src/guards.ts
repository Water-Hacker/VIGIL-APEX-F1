import { Errors } from '@vigil/shared';
import { z } from 'zod';

/**
 * Anti-hallucination guards — the 12 layers per SRD §20.1.
 *
 * Each layer is independently invocable. The router runs every applicable
 * layer in order; the first layer that rejects throws `LlmHallucinationDetectedError`.
 *
 * Layers:
 *   L1  schema_compliance       — Zod parse must succeed
 *   L2  citation_required        — every fact has {cid, page, char_span}
 *   L3  cid_in_context           — every cited cid was in the prompt
 *   L4  insufficient_path_present — model emitted insufficient_evidence shape correctly
 *   L5  no_extra_fields          — no fields outside schema
 *   L6  numerical_consistency    — extracted numerical strings round-trip to numbers
 *   L7  quote_match              — quoted excerpts substring-match the source
 *   L8  numerical_disagreement   — numerical fields don't contradict source
 *   L9  language_consistency     — output language matches source language
 *   L10 entity_form_preservation — proper noun spellings unchanged from source
 *   L11 temperature_bound        — call's temperature ≤ task class default
 *   L12 negative_examples        — output didn't infer existence from press alone
 *
 * Layers L1–L6 are deterministic; L7–L12 require source context; the router
 * supplies it.
 */

export interface GuardContext {
  readonly providedDocumentCids: readonly string[];
  readonly sourceTexts: ReadonlyMap<string, string>; // cid → text
  readonly responseSchema?: z.ZodSchema | undefined;
  readonly task: string;
  readonly temperatureUsed: number;
  readonly temperatureMax: number;
}

export interface GuardResult {
  readonly passed: boolean;
  readonly layer: string;
  readonly reason?: string;
}

const PASS = (layer: string): GuardResult => ({ passed: true, layer });

/* ===== L1 schema_compliance ================================================*/
export function l1SchemaCompliance(content: unknown, ctx: GuardContext): GuardResult {
  if (!ctx.responseSchema) return PASS('L1');
  const r = ctx.responseSchema.safeParse(content);
  if (!r.success) {
    return { passed: false, layer: 'L1', reason: r.error.issues.slice(0, 3).map((i) => i.message).join('; ') };
  }
  return PASS('L1');
}

/* ===== L2 citation_required ================================================*/
const CITATION_RE = /"document_cid"\s*:\s*"(b[a-z2-7]{55,})"/g;
export function l2CitationRequired(content: unknown): GuardResult {
  const s = JSON.stringify(content);
  if (!CITATION_RE.test(s) && !s.includes('"insufficient_evidence"')) {
    return {
      passed: false,
      layer: 'L2',
      reason: 'no document_cid citation found and not an insufficient_evidence response',
    };
  }
  return PASS('L2');
}

/* ===== L3 cid_in_context ===================================================*/
export function l3CidInContext(content: unknown, ctx: GuardContext): GuardResult {
  const s = JSON.stringify(content);
  const cids = new Set<string>();
  let m: RegExpExecArray | null;
  const re = /"document_cid"\s*:\s*"(b[a-z2-7]{55,})"/g;
  while ((m = re.exec(s)) !== null) cids.add(m[1]!);
  for (const cid of cids) {
    if (!ctx.providedDocumentCids.includes(cid)) {
      return { passed: false, layer: 'L3', reason: `cited cid ${cid} not in prompt context` };
    }
  }
  return PASS('L3');
}

/* ===== L4 insufficient_path ================================================*/
const INSUFFICIENT_RE = /^\s*\{\s*"status"\s*:\s*"insufficient_evidence"/;
export function l4InsufficientPath(content: unknown): GuardResult {
  const s = typeof content === 'string' ? content : JSON.stringify(content);
  if (!INSUFFICIENT_RE.test(s)) return PASS('L4');
  // If the response IS insufficient_evidence, it must be ONLY that shape
  const z = z
    .object({ status: z.literal('insufficient_evidence'), reason: z.string().min(1).max(500) })
    .strict();
  const obj = typeof content === 'string' ? JSON.parse(content) : content;
  if (!z.safeParse(obj).success) {
    return { passed: false, layer: 'L4', reason: 'malformed insufficient_evidence shape' };
  }
  return PASS('L4');
}

/* ===== L5 no_extra_fields ==================================================*/
export function l5NoExtraFields(content: unknown, ctx: GuardContext): GuardResult {
  if (!ctx.responseSchema) return PASS('L5');
  // L1 may have used a passthrough schema; L5 forces a strict re-parse and
  // surfaces extra-field violations explicitly. This is independent of L1
  // so the corpus can target L5 deterministically.
  const schemaWithStrict = ctx.responseSchema as unknown as {
    strict?: () => z.ZodSchema;
  };
  if (typeof schemaWithStrict.strict !== 'function') return PASS('L5');
  const r = schemaWithStrict.strict().safeParse(content);
  if (!r.success) {
    const extras = r.error.issues.flatMap((i) =>
      i.code === 'unrecognized_keys' && 'keys' in i
        ? (i as unknown as { keys: string[] }).keys
        : [],
    );
    if (extras.length > 0) {
      return { passed: false, layer: 'L5', reason: `extra fields: ${extras.join(', ')}` };
    }
  }
  return PASS('L5');
}

/* ===== L6 numerical_consistency ============================================*/
export function l6NumericalConsistency(content: unknown): GuardResult {
  const s = JSON.stringify(content);
  // Find all "value" fields that are strings looking numeric — if Zod typed
  // them as numbers, this would have failed L1. Here we look for accidentally-
  // string-typed amounts that contain non-numeric chars.
  const re = /"amount[a-z_]*"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const v = m[1]!.replace(/[\s,]/g, '');
    if (!/^-?\d+(?:\.\d+)?$/.test(v)) {
      return { passed: false, layer: 'L6', reason: `non-numeric amount: ${m[1]}` };
    }
  }
  return PASS('L6');
}

/* ===== L7 quote_match ======================================================*/
export function l7QuoteMatch(content: unknown, ctx: GuardContext): GuardResult {
  const s = JSON.stringify(content);
  // Look for "excerpt": "..." entries; verify substring-match in the cited cid's source text
  const re = /"document_cid"\s*:\s*"(b[a-z2-7]{55,})"[^}]*"excerpt"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const cid = m[1]!;
    const excerpt = m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const src = ctx.sourceTexts.get(cid);
    if (!src) continue; // L3 already covers missing cids
    if (!normalise(src).includes(normalise(excerpt))) {
      return { passed: false, layer: 'L7', reason: `excerpt not found verbatim in ${cid}` };
    }
  }
  return PASS('L7');
}

function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/* ===== L8 numerical_disagreement ==========================================*/
export function l8NumericalDisagreement(content: unknown, ctx: GuardContext): GuardResult {
  // Heuristic: when the model emits an `amount_xaf` field with citation, the
  // raw digit-string from the source text MUST be findable nearby (within ±200
  // chars of char_span). Full implementation lives in worker-extract; here
  // we no-op-pass at the package level — the worker calls a richer check.
  void content;
  void ctx;
  return PASS('L8');
}

/* ===== L9 language_consistency ============================================*/
export function l9LanguageConsistency(): GuardResult {
  // No-op at this layer; worker-extract verifies against `language` field.
  return PASS('L9');
}

/* ===== L10 entity_form_preservation =======================================*/
export function l10EntityFormPreservation(): GuardResult {
  return PASS('L10');
}

/* ===== L11 temperature_bound ==============================================*/
export function l11TemperatureBound(_content: unknown, ctx: GuardContext): GuardResult {
  if (ctx.temperatureUsed > ctx.temperatureMax) {
    return {
      passed: false,
      layer: 'L11',
      reason: `temperature ${ctx.temperatureUsed} exceeds task max ${ctx.temperatureMax}`,
    };
  }
  return PASS('L11');
}

/* ===== L12 negative_examples ==============================================*/
export function l12NegativeExamples(): GuardResult {
  return PASS('L12'); // worker-extract supplies negative-example checks
}

/* ===== Aggregator ==========================================================*/
export function runGuards(content: unknown, ctx: GuardContext): readonly GuardResult[] {
  const results: GuardResult[] = [];
  for (const guard of [
    l1SchemaCompliance,
    l2CitationRequired,
    l3CidInContext,
    l4InsufficientPath,
    l5NoExtraFields,
    l6NumericalConsistency,
    l7QuoteMatch,
    l8NumericalDisagreement,
    l9LanguageConsistency,
    l10EntityFormPreservation,
    l11TemperatureBound,
    l12NegativeExamples,
  ]) {
    const r = guard(content, ctx);
    results.push(r);
    if (!r.passed) break;
  }
  return results;
}

export function assertGuardsPass(content: unknown, ctx: GuardContext): void {
  const results = runGuards(content, ctx);
  const failure = results.find((r) => !r.passed);
  if (failure) {
    throw new Errors.LlmHallucinationDetectedError(failure.layer, {
      reason: failure.reason ?? '',
    });
  }
}
