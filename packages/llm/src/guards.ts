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
    return {
      passed: false,
      layer: 'L1',
      reason: r.error.issues
        .slice(0, 3)
        .map((i) => i.message)
        .join('; '),
    };
  }
  return PASS('L1');
}

/* ===== L2 citation_required ================================================*/
// Non-global pattern — reused across calls. A `/g` flag would carry
// `lastIndex` between calls and produce false negatives on the call
// immediately after a successful match.
const CITATION_RE = /"document_cid"\s*:\s*"b[a-z2-7]{55,}"/;
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
  const schema = z
    .object({ status: z.literal('insufficient_evidence'), reason: z.string().min(1).max(500) })
    .strict();
  const obj = typeof content === 'string' ? JSON.parse(content) : content;
  if (!schema.safeParse(obj).success) {
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
/**
 * L8 — when the model emits a numeric field (`amount_xaf`,
 * `amount_xaf_equivalent`, `bidder_count`, etc.) WITH a `document_cid`
 * + `char_span` pair, verify that at least one numeric run inside the
 * cited window is within ±5% of the claimed value. Order-of-magnitude
 * mismatches (claimed 5,000,000 vs source "50,000,000") rejected.
 *
 * Pulls the source text from `ctx.sourceTexts.get(document_cid)` and
 * inspects the substring `[char_span[0]-PAD .. char_span[1]+PAD]`. PAD
 * gives the model some slack since LLM-supplied char_spans are often
 * 5-10 chars off from the exact digit-run.
 */
export function l8NumericalDisagreement(content: unknown, ctx: GuardContext): GuardResult {
  const obj = asObject(content);
  if (!obj) return PASS('L8');
  const cid = typeof obj['document_cid'] === 'string' ? obj['document_cid'] : null;
  const span = obj['char_span'];
  if (!cid || !Array.isArray(span) || span.length !== 2) return PASS('L8');
  const [start, end] = [Number(span[0]), Number(span[1])];
  if (!Number.isFinite(start) || !Number.isFinite(end)) return PASS('L8');
  const source = ctx.sourceTexts.get(cid);
  if (!source) return PASS('L8');

  // Numeric fields the model might emit. Pull each one as a number.
  const candidates: Array<{ field: string; value: number }> = [];
  for (const field of ['amount_xaf', 'amount_xaf_equivalent', 'bidder_count', 'unit_price_xaf']) {
    const raw = obj[field];
    if (raw === undefined) continue;
    const n =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number.parseFloat(raw.replace(/[\s,]/g, ''))
          : NaN;
    if (Number.isFinite(n)) candidates.push({ field, value: n });
  }
  if (candidates.length === 0) return PASS('L8');

  const PAD = 32;
  const lo = Math.max(0, Math.floor(start) - PAD);
  const hi = Math.min(source.length, Math.ceil(end) + PAD);
  const window = source.slice(lo, hi);
  // Pull every digit run; treat thousands separators (",", " ", ".") as
  // grouping when sandwiched between digits.
  const sourceNumbers: number[] = [];
  for (const m of window.matchAll(/(\d{1,3}(?:[\s,. ]\d{3})+|\d{1,15})/g)) {
    const raw = m[1] ?? '';
    const n = Number.parseInt(raw.replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(n) && n >= 0) sourceNumbers.push(n);
  }
  if (sourceNumbers.length === 0) {
    return {
      passed: false,
      layer: 'L8',
      reason: `no numeric run found in source span [${lo}..${hi}] for ${candidates[0]!.field}`,
    };
  }
  for (const c of candidates) {
    const ok = sourceNumbers.some((n) => withinTolerance(c.value, n, 0.05));
    if (!ok) {
      return {
        passed: false,
        layer: 'L8',
        reason: `claimed ${c.field}=${c.value} disagrees with source ${sourceNumbers.join(',')}`,
      };
    }
  }
  return PASS('L8');
}

function withinTolerance(claimed: number, source: number, frac: number): boolean {
  if (source === 0) return Math.abs(claimed) <= frac;
  return Math.abs(claimed - source) / Math.max(1, Math.abs(source)) <= frac;
}

/* ===== L9 language_consistency ============================================*/
/**
 * L9 — when the model declares a `language` field AND emits human-text
 * fields (`summary`, `rationale`, `description`), the detected language
 * of those text fields must match the declared one. Heuristic detector:
 * counts French-distinctive function words (`le`, `la`, `les`, `et`,
 * `de`, `pour`, `dans`, `avec`) versus English-distinctive ones (`the`,
 * `and`, `of`, `for`, `with`, `from`). Whichever side wins by ≥ 3 hits
 * is the detected language; ties / sparse text → 'unknown' (pass).
 */
export function l9LanguageConsistency(content: unknown): GuardResult {
  const obj = asObject(content);
  if (!obj) return PASS('L9');
  const declared = typeof obj['language'] === 'string' ? obj['language'].toLowerCase() : null;
  if (!declared || (declared !== 'fr' && declared !== 'en')) return PASS('L9');
  const textFields = ['summary', 'rationale', 'description', 'text'];
  for (const f of textFields) {
    const v = obj[f];
    if (typeof v !== 'string' || v.trim().length < 10) continue;
    const detected = detectFrEn(v);
    if (detected === 'unknown') continue;
    if (detected !== declared) {
      return {
        passed: false,
        layer: 'L9',
        reason: `declared language=${declared} but ${f} appears to be ${detected}`,
      };
    }
  }
  return PASS('L9');
}

const FR_TOKENS = new Set([
  'le',
  'la',
  'les',
  'et',
  'de',
  'des',
  'du',
  'pour',
  'dans',
  'avec',
  'sur',
  'est',
  'sont',
  'que',
  'qui',
  'cette',
  'ce',
  'aux',
  'par',
  'son',
  'sa',
  'ses',
  'mais',
  'plus',
  'pas',
  'à',
  'été',
  'fut',
  'a',
  'au',
  'ne',
  'leur',
  'cet',
  'fournisseur',
  'marché',
  'avenant',
  'attribué',
  'signé',
  'autorité',
]);
const EN_TOKENS = new Set([
  'the',
  'and',
  'of',
  'for',
  'with',
  'from',
  'is',
  'are',
  'this',
  'that',
  'these',
  'those',
  'on',
  'at',
  'in',
  'by',
  'to',
  'as',
  'was',
  'were',
  'has',
  'have',
  'but',
  'not',
  'an',
  'be',
  'been',
  'will',
  'would',
  'late',
  'supplier',
  'contract',
  'amendment',
  'awarded',
  'signed',
  'authority',
]);

function detectFrEn(s: string): 'fr' | 'en' | 'unknown' {
  const tokens = s
    .toLowerCase()
    .replace(/[^a-zà-ÿ\s]/giu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  let fr = 0;
  let en = 0;
  for (const t of tokens) {
    if (FR_TOKENS.has(t)) fr += 1;
    if (EN_TOKENS.has(t)) en += 1;
  }
  // Threshold scales with text length: shorter texts get a tighter
  // threshold (1) since procurement summaries are often single sentences.
  const minDelta = tokens.length <= 6 ? 1 : tokens.length <= 12 ? 2 : 3;
  if (fr - en >= minDelta && en === 0) return 'fr';
  if (en - fr >= minDelta && fr === 0) return 'en';
  if (fr - en >= minDelta + 1) return 'fr';
  if (en - fr >= minDelta + 1) return 'en';
  return 'unknown';
}

/* ===== L10 entity_form_preservation =======================================*/
/**
 * L10 — when the model emits an `entity` field WITH a `document_cid`
 * citation, the entity name must appear verbatim in the cited source
 * text. Whitespace-tolerant compare (collapse runs of whitespace),
 * but every non-whitespace character must match. Catches:
 *   - "SOCIETE Camerounaise"           vs source "SOCIETE Camerounaise des Eaux"
 *     (truncation — substring match ✓, passes)
 *   - "Mr. John Smithh" (extra h)       vs source "Mr. John Smith"
 *     (mutation — substring not found, REJECT)
 *   - "Société Cameroumaise" (typo)     vs source "Société Camerounaise"
 *     (mutation, REJECT)
 */
export function l10EntityFormPreservation(content: unknown, ctx: GuardContext): GuardResult {
  const obj = asObject(content);
  if (!obj) return PASS('L10');
  const cid = typeof obj['document_cid'] === 'string' ? obj['document_cid'] : null;
  const entity = typeof obj['entity'] === 'string' ? obj['entity'] : null;
  if (!cid || !entity || entity.trim().length === 0) return PASS('L10');
  const source = ctx.sourceTexts.get(cid);
  if (!source) return PASS('L10');
  const normSource = source.replace(/\s+/g, ' ').trim();
  const normEntity = entity.replace(/\s+/g, ' ').trim();
  const idx = normSource.indexOf(normEntity);
  if (idx === -1) {
    return {
      passed: false,
      layer: 'L10',
      reason: `entity '${entity}' not present verbatim in source ${cid}`,
    };
  }
  // Boundary check — the char immediately AFTER the match must not be a
  // letter (otherwise the entity is a strict prefix of a longer name in
  // the source, which is a truncation and a form-preservation failure).
  const after = normSource.charAt(idx + normEntity.length);
  if (after && /[a-zà-ÿA-ZÀ-Ÿ]/.test(after)) {
    return {
      passed: false,
      layer: 'L10',
      reason: `entity '${entity}' is a truncation of a longer name in source ${cid}`,
    };
  }
  // Same check for the prefix character — otherwise we'd accept "Smith"
  // when the source says "Goldsmith".
  const before = idx > 0 ? normSource.charAt(idx - 1) : '';
  if (before && /[a-zà-ÿA-ZÀ-Ÿ]/.test(before)) {
    return {
      passed: false,
      layer: 'L10',
      reason: `entity '${entity}' is a partial of a longer name in source ${cid}`,
    };
  }
  // Multi-word truncation check: when the source continues with a
  // noun-phrase connector (`des`, `du`, `de`, `of`, `and`) followed by
  // a Capitalized continuation, the entity is a truncated proper noun.
  const continuation = normSource.slice(idx + normEntity.length).trimStart();
  const m = continuation.match(/^(des|du|de|de\s+l|d['']|of|and|et)\s+([A-ZÀ-Ÿ])/);
  if (m) {
    return {
      passed: false,
      layer: 'L10',
      reason: `entity '${entity}' truncates a longer phrase in source ${cid} (continues with '${m[0].slice(0, 30)}…')`,
    };
  }
  return PASS('L10');
}

function asObject(content: unknown): Record<string, unknown> | null {
  if (typeof content !== 'object' || content === null) return null;
  return content as Record<string, unknown>;
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
/**
 * L12 — refuse to assert existence of an entity / contract / claim
 * based purely on a press source. Operationalised as: when the model's
 * output has a `sources` array AND an `entity` / `contract_id` /
 * `existence_confidence` field, every source in the array must contain
 * at least one PRIMARY-source token (RCCM, treasury, journal officiel,
 * gazette, audit_report, court_judgement, official_record, primary).
 * Press-only (`press article`, `news.com`, `magazine`, `interview`)
 * → REJECT.
 *
 * Closes the SRD §20 "press-as-existence-proof" failure mode: a model
 * that reads a press article saying "Project X exists" will not infer
 * existence into a finding without a primary record.
 */
export function l12NegativeExamples(content: unknown): GuardResult {
  const obj = asObject(content);
  if (!obj) return PASS('L12');
  const triggersExistenceClaim =
    typeof obj['existence_confidence'] === 'number' ||
    typeof obj['contract_id'] === 'string' ||
    typeof obj['entity'] === 'string';
  if (!triggersExistenceClaim) return PASS('L12');
  const sources = obj['sources'];
  if (!Array.isArray(sources) || sources.length === 0) return PASS('L12');
  const PRIMARY_RE =
    /\b(rccm|treasury|journal\s+officiel|gazette|audit_report|court_judgement|official_record|primary|cdc|opencorporates|sanctions_listing|cour\s+des\s+comptes|tcs)\b/i;
  const PRESS_RE = /\b(press|news|article|magazine|interview|tabloid|blog)\b/i;
  let primaryCount = 0;
  let pressOnlyCount = 0;
  for (const raw of sources) {
    const s = typeof raw === 'string' ? raw : '';
    if (PRIMARY_RE.test(s)) primaryCount += 1;
    else if (PRESS_RE.test(s)) pressOnlyCount += 1;
  }
  if (primaryCount === 0 && pressOnlyCount > 0) {
    return {
      passed: false,
      layer: 'L12',
      reason: `existence claim sourced only from press (${pressOnlyCount} press, 0 primary)`,
    };
  }
  return PASS('L12');
}

/* ===== Aggregator ==========================================================*/
export function runGuards(content: unknown, ctx: GuardContext): readonly GuardResult[] {
  const results: GuardResult[] = [];
  // L12 runs BEFORE L2 — press-only existence claims need to be caught
  // by their semantic rule, not bounced at the citation gate. The L12
  // guard is a precondition shape-check (it only fires when the model
  // emits `existence_confidence` / `entity` / `contract_id` AND a
  // `sources` array), so it never falsely rejects normal extractions
  // that lack those fields.
  for (const guard of [
    l1SchemaCompliance,
    l12NegativeExamples,
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
