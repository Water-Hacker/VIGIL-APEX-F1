/**
 * Deterministic French/Cameroonian procurement field extractor.
 *
 * Pure functions. No I/O. No LLM. No clock reads. No randomness.
 * Every rule is named so its provenance can be persisted.
 *
 * Fires first (before LLM) per AI-SAFETY-DOCTRINE-v1 §B.10 (LLM-as-fallback,
 * not LLM-as-primary). When this layer is sufficient, we never call Claude
 * at all — saving cost, latency, and adding tamper-resistance (a model
 * provider compromise can never alter what regex extraction returned).
 *
 * Designed to run on the raw `cells` + `raw_text` payloads emitted by:
 *   - apps/adapter-runner/src/adapters/armp-main.ts
 *   - apps/adapter-runner/src/adapters/minmap-portal.ts
 *   - apps/adapter-runner/src/adapters/coleps-tenders.ts
 *
 * Hardening:
 *   - Every regex is bounded (no unbounded `.*`).
 *   - Every numeric extraction caps at PLAUSIBLE_MAX_XAF (10 trillion CFA)
 *     to prevent overflow / DoS via malicious large numbers.
 *   - Every text input length-clamped to MAX_INPUT_CHARS before scanning.
 *   - Status keywords matched case-insensitively against a closed allow-list
 *     (no user-controlled regex injection possible).
 */

import type {
  ProcurementFields,
  ProcurementMethod,
  ExtractionFieldProvenance,
  ProcurementFieldKey,
} from '@vigil/shared/schemas';

// --- safety bounds ----------------------------------------------------------
/** Max raw input the extractor will scan; longer inputs are truncated to
 *  this length before regex matching. ARMP listings rarely exceed 50 KB; this
 *  is a hard upper bound to prevent quadratic-regex DoS. */
const MAX_INPUT_CHARS = 200_000;
/** Implausible upper bound for an XAF amount. Cameroon's largest single
 *  procurement on record (Lom-Pangar) was ~250 billion XAF; we cap at
 *  10 trillion to leave headroom but reject obvious garbage. */
const PLAUSIBLE_MAX_XAF = 10_000_000_000_000;
/** Implausible upper bound for bidder count. */
const PLAUSIBLE_MAX_BIDDERS = 1000;

// --- closed allow-lists (no regex injection possible) ----------------------
const STATUS_KEYWORDS = new Set([
  'exclusion',
  'exclu',
  'résilié',
  'resilie',
  'résiliation',
  'resiliation',
  'infructueux',
  'sans suite',
  'attribué',
  'attribue',
  'avenant',
  'annulation',
  'annulé',
  'annule',
  'avis',
  'consultation',
  'gré à gré',
  'gre a gre',
  'sole-source',
  'lot infructueux',
]);

const REGION_KEYWORDS: ReadonlyArray<{ canonical: string; needles: ReadonlyArray<string> }> = [
  { canonical: 'Adamaoua', needles: ['adamaoua', 'ngaoundéré', 'ngaoundere'] },
  { canonical: 'Centre', needles: ['centre', 'yaoundé', 'yaounde', 'mbalmayo', 'obala'] },
  { canonical: 'Est', needles: ["région de l'est", "region de l'est", 'bertoua', 'batouri'] },
  { canonical: 'Extrême-Nord', needles: ['extrême-nord', 'extreme-nord', 'maroua', 'kousseri'] },
  { canonical: 'Littoral', needles: ['littoral', 'douala', 'edéa', 'edea'] },
  { canonical: 'Nord', needles: ['région du nord', 'region du nord', 'garoua'] },
  { canonical: 'Nord-Ouest', needles: ['nord-ouest', 'bamenda', 'kumbo'] },
  {
    canonical: 'Ouest',
    needles: ["région de l'ouest", "region de l'ouest", 'bafoussam', 'dschang', 'foumban'],
  },
  {
    canonical: 'Sud',
    needles: ['région du sud', 'region du sud', 'ebolowa', 'kribi', 'sangmélima', 'sangmelima'],
  },
  { canonical: 'Sud-Ouest', needles: ['sud-ouest', 'buea', 'limbe', 'tiko'] },
];

// --- types ------------------------------------------------------------------
export interface ExtractedFieldRecord<K extends ProcurementFieldKey> {
  readonly key: K;
  readonly value: ProcurementFields[K];
  readonly provenance: ExtractionFieldProvenance;
}

export interface DeterministicExtraction {
  readonly fields: Partial<ProcurementFields>;
  readonly provenance: Partial<Record<ProcurementFieldKey, ExtractionFieldProvenance>>;
  /** Fields the deterministic layer could NOT extract — passed to LLM. */
  readonly unresolved: ReadonlyArray<ProcurementFieldKey>;
}

export interface DeterministicInput {
  /** The raw text chunks the adapter scraped. Concatenated with " · " by
   *  the extractor; do NOT pre-join with newlines (loses cell boundaries). */
  readonly cells: ReadonlyArray<string>;
  /** Optional raw concatenated text the adapter has already prepared. */
  readonly raw_text?: string | null;
}

// --- helpers ----------------------------------------------------------------
function pinned(rule: string, confidence = 1.0): ExtractionFieldProvenance {
  return { method: 'deterministic', detail: rule, confidence };
}

function clampInput(input: DeterministicInput): string {
  const joined = [...input.cells, input.raw_text ?? ''].filter((s) => s.length > 0).join(' · ');
  return joined.slice(0, MAX_INPUT_CHARS);
}

/** Normalize whitespace + lowercase for case-insensitive matching, but keep
 *  diacritics (matters for "gré à gré" detection). */
function nrm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// --- extractors -------------------------------------------------------------

/**
 * Procurement method — one of the canonical six values.
 * Matches French procurement vocabulary (ARMP standard terminology).
 */
function extractProcurementMethod(text: string): { value: ProcurementMethod; rule: string } | null {
  const t = nrm(text);
  // JavaScript's `\b` only respects ASCII word chars, so French accented
  // tokens use a custom boundary: start-of-string OR non-letter char.
  // Order matters — "gré à gré" must match before "marché" generic
  if (/(?:^|[^a-zà-ÿ])gr[ée]\s+[àa]\s+gr[ée](?:[^a-zà-ÿ]|$)/u.test(t)) {
    return { value: 'gre_a_gre', rule: 'pm.gre-a-gre' };
  }
  if (/(?:^|[^a-z])sole[\s-]source(?:[^a-z]|$)/.test(t))
    return { value: 'gre_a_gre', rule: 'pm.sole-source' };
  if (/(?:^|[^a-z])single[\s-]source(?:[^a-z]|$)/.test(t))
    return { value: 'gre_a_gre', rule: 'pm.single-source' };
  if (/(?:^|[^a-z])appel\s+d['']offres\s+ouvert(?:[^a-z]|$)/.test(t)) {
    return { value: 'appel_offres_ouvert', rule: 'pm.aoo' };
  }
  if (
    /(?:^|[^a-z])appel\s+d['']offres\s+restreint(?:[^a-z]|$)/.test(t) ||
    /(?:^|[^a-z])ao\s+restreint(?:[^a-z]|$)/.test(t)
  ) {
    return { value: 'appel_offres_restreint', rule: 'pm.aor' };
  }
  if (/(?:^|[^a-zà-ÿ])march[ée]\s+n[ée]goci[ée](?:[^a-zà-ÿ]|$)/u.test(t)) {
    return { value: 'marche_negocie', rule: 'pm.negocie' };
  }
  if (/(?:^|[^a-zà-ÿ])consultation\s+simplifi[ée]e(?:[^a-zà-ÿ]|$)/u.test(t)) {
    return { value: 'consultation_simplifie', rule: 'pm.simplifiee' };
  }
  if (/(?:^|[^a-z])concours(?:[^a-z]|$)/.test(t) && /architect|conception/.test(t)) {
    return { value: 'concours', rule: 'pm.concours' };
  }
  return null;
}

/**
 * Bidder count — explicit numeric cue ("3 soumissionnaires", "5 offres",
 * "soumissionnaire unique"). Refuses ambiguous matches.
 */
function extractBidderCount(text: string): { value: number; rule: string } | null {
  const t = nrm(text);
  // Singular indicators — "soumissionnaire unique", "offre unique"
  if (/\bsoumissionnaire\s+unique\b/.test(t) || /\boffre\s+unique\b/.test(t)) {
    return { value: 1, rule: 'bc.unique-cue' };
  }
  if (/\bun\s+seul\s+soumissionnaire\b/.test(t)) {
    return { value: 1, rule: 'bc.un-seul' };
  }
  // No-bid extension — fires "single bidder" semantically for downstream patterns
  if (/\bsans\s+mise\s+en\s+concurrence\b/.test(t)) {
    return { value: 1, rule: 'bc.sans-concurrence' };
  }
  // Numeric cue — "X soumissionnaires" / "X offres" / "X candidatures"
  const m = t.match(/\b(\d{1,3})\s+(soumissionnaires?|offres?|candidatures?)\b/);
  if (m && m[1]) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 0 && n <= PLAUSIBLE_MAX_BIDDERS) {
      return { value: n, rule: 'bc.numeric-cue' };
    }
  }
  return null;
}

/**
 * Amount in CFA francs. Handles French number formatting:
 *   - "123 456 789 FCFA" (space-separated thousands)
 *   - "123.456.789 XAF" (dot-separated, sometimes seen on legacy ledgers)
 *   - "123,456,789.50 FCFA" (anglo-style)
 *   - Million/milliard cues: "12 milliards FCFA", "350 millions XAF"
 */
function extractAmountXaf(text: string): { value: number; rule: string } | null {
  const t = nrm(text);
  // milliards / millions cue (high-precision phrasing common in awards)
  const milliards = t.match(
    /\b(\d{1,3}(?:[.,]\d{1,3})?)\s+milliards?\s+(?:de\s+)?(?:fcfa|xaf|cfa)\b/,
  );
  if (milliards && milliards[1]) {
    const n = Number.parseFloat(milliards[1].replace(',', '.'));
    if (Number.isFinite(n) && n > 0) {
      const value = Math.round(n * 1_000_000_000);
      if (value > 0 && value <= PLAUSIBLE_MAX_XAF) return { value, rule: 'amt.milliards' };
    }
  }
  const millions = t.match(
    /\b(\d{1,3}(?:[.,]\d{1,3})?)\s+millions?\s+(?:de\s+)?(?:fcfa|xaf|cfa)\b/,
  );
  if (millions && millions[1]) {
    const n = Number.parseFloat(millions[1].replace(',', '.'));
    if (Number.isFinite(n) && n > 0) {
      const value = Math.round(n * 1_000_000);
      if (value > 0 && value <= PLAUSIBLE_MAX_XAF) return { value, rule: 'amt.millions' };
    }
  }
  // Numeric forms with currency — try widest match first to avoid partial-grab
  // Pattern: digit groups separated by space/dot/comma, optional decimal, then FCFA/XAF/CFA
  const numeric = t.match(
    /\b(\d{1,3}(?:[\s.,]\d{3})+(?:[.,]\d{1,2})?|\d{4,15}(?:[.,]\d{1,2})?)\s*(fcfa|xaf|cfa)\b/,
  );
  if (numeric && numeric[1]) {
    // Strip thousands separators (space/dot/comma in the integer portion).
    // The decimal separator is the last "," or "." with 1-2 digits after it.
    const raw = numeric[1];
    const lastDot = raw.lastIndexOf('.');
    const lastComma = raw.lastIndexOf(',');
    const decIdx = Math.max(lastDot, lastComma);
    let intPart = raw;
    let decPart = '';
    if (decIdx >= 0 && /^\d{1,2}$/.test(raw.slice(decIdx + 1))) {
      intPart = raw.slice(0, decIdx);
      decPart = raw.slice(decIdx + 1);
    }
    const intDigits = intPart.replace(/[\s.,]/g, '');
    if (/^\d+$/.test(intDigits)) {
      const value =
        decPart.length > 0
          ? Math.round(Number.parseFloat(`${intDigits}.${decPart}`))
          : Number.parseInt(intDigits, 10);
      if (Number.isFinite(value) && value > 0 && value <= PLAUSIBLE_MAX_XAF) {
        return { value, rule: 'amt.numeric' };
      }
    }
  }
  return null;
}

/**
 * ISO date — accepts "YYYY-MM-DD", "DD/MM/YYYY", "DD/MM/YY", "DD month YYYY"
 * (FR), "DD month YYYY" (EN). Returns canonical YYYY-MM-DD.
 *
 * This function is parameterised by a "label" that introduces the date so
 * we extract the right one from a payload that contains many dates.
 */
function extractDate(
  text: string,
  labels: ReadonlyArray<string>,
  ruleName: string,
): { value: string; rule: string } | null {
  const t = text; // do NOT lowercase — month names matter
  for (const label of labels) {
    const re = new RegExp(
      // Order alternatives longest-first so greedy matching prefers the
      // long-form (DD month YYYY) over the short numeric form starting
      // with the same leading digits.
      `(?:^|[^a-zà-ÿ])${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:\\-—]?\\s*(\\d{1,2}\\s+\\p{L}+\\s+\\d{2,4}|\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4})`,
      'iu',
    );
    const m = t.match(re);
    if (m && m[1]) {
      const iso = parseToIso(m[1]);
      if (iso !== null) return { value: iso, rule: ruleName };
    }
  }
  return null;
}

const FR_MONTHS: Record<string, string> = {
  janvier: '01',
  février: '02',
  fevrier: '02',
  mars: '03',
  avril: '04',
  mai: '05',
  juin: '06',
  juillet: '07',
  août: '08',
  aout: '08',
  septembre: '09',
  octobre: '10',
  novembre: '11',
  décembre: '12',
  decembre: '12',
};

function parseToIso(s: string): string | null {
  const trimmed = s.trim();
  // YYYY-MM-DD already
  let m = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    if (y && mo && d) return formatIso(y, mo, d);
  }
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  m = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const [, d, mo, y] = m;
    if (d && mo && y) {
      const yy = y.length === 2 ? `20${y}` : y;
      return formatIso(yy, mo, d);
    }
  }
  // DD month YYYY (FR)
  m = trimmed.match(/^(\d{1,2})\s+([\p{L}]+)\s+(\d{2,4})$/iu);
  if (m) {
    const [, d, monthRaw, y] = m;
    if (d && monthRaw && y) {
      const mo = FR_MONTHS[monthRaw.toLowerCase()];
      if (mo !== undefined) {
        const yy = y.length === 2 ? `20${y}` : y;
        return formatIso(yy, mo, d);
      }
    }
  }
  return null;
}

function formatIso(y: string, mo: string, d: string): string | null {
  const yy = Number.parseInt(y, 10);
  const mm = Number.parseInt(mo, 10);
  const dd = Number.parseInt(d, 10);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  // Plausibility: years 1990..2099, months 1..12, days 1..31
  if (yy < 1990 || yy > 2099) return null;
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  return `${yy.toString().padStart(4, '0')}-${mm.toString().padStart(2, '0')}-${dd.toString().padStart(2, '0')}`;
}

/** Cameroonian RCCM (registre du commerce) — format `RC/<region>/<year>/<seq>`. */
function extractSupplierRccm(text: string): { value: string; rule: string } | null {
  // Tolerant — matches RC/YAO/2019/B/1234, RC/DLA/2024/A/89, etc.
  const m = text.match(/\bRC[/\\-][A-Z]{2,4}[/\\-]\d{4}[/\\-][A-Z][/\\-]\d{1,6}\b/);
  if (m) return { value: m[0], rule: 'rccm.standard' };
  return null;
}

/** Cameroonian NIU (Numéro d'Identifiant Unique) — fiscal id, 14 char alphanumeric. */
function extractSupplierNiu(text: string): { value: string; rule: string } | null {
  const m = text.match(/\b(NIU|N\.I\.U\.)\s*[:\-—]?\s*([A-Z0-9]{14})\b/i);
  if (m && m[2]) return { value: m[2].toUpperCase(), rule: 'niu.standard' };
  return null;
}

/** Region — first matching needle wins. */
function extractRegion(text: string): { value: string; rule: string } | null {
  const t = nrm(text);
  for (const r of REGION_KEYWORDS) {
    for (const needle of r.needles) {
      if (t.includes(needle))
        return { value: r.canonical, rule: `region.${r.canonical.toLowerCase()}` };
    }
  }
  return null;
}

/** Status keywords surfaced from a closed allow-list. */
function extractStatusKeywords(text: string): { value: string[]; rule: string } | null {
  const t = nrm(text);
  const found: string[] = [];
  for (const k of STATUS_KEYWORDS) {
    if (t.includes(k.toLowerCase()) && !found.includes(k)) found.push(k);
  }
  return found.length > 0 ? { value: found, rule: 'status.keywords' } : null;
}

/** Escalation clause — text contains "clause de révision" / "indexation des prix". */
function extractEscalationClause(text: string): { value: boolean; rule: string } | null {
  const t = nrm(text);
  if (
    /\bclause\s+de\s+r[ée]vision\b/.test(t) ||
    /\bindexation\s+des\s+prix\b/.test(t) ||
    /\bprice\s+escalation\b/.test(t)
  ) {
    return { value: true, rule: 'esc.clause-present' };
  }
  return null;
}

// --- top-level orchestrator -------------------------------------------------

export function extractDeterministically(input: DeterministicInput): DeterministicExtraction {
  const text = clampInput(input);
  const fields: Partial<ProcurementFields> = {};
  const provenance: Partial<Record<ProcurementFieldKey, ExtractionFieldProvenance>> = {};

  const pm = extractProcurementMethod(text);
  if (pm) {
    fields.procurement_method = pm.value;
    provenance.procurement_method = pinned(pm.rule);
  }

  const bc = extractBidderCount(text);
  if (bc) {
    fields.bidder_count = bc.value;
    provenance.bidder_count = pinned(bc.rule);
  }

  const amt = extractAmountXaf(text);
  if (amt) {
    fields.amount_xaf = amt.value;
    provenance.amount_xaf = pinned(amt.rule);
  }

  const rccm = extractSupplierRccm(text);
  if (rccm) {
    fields.supplier_rccm = rccm.value;
    provenance.supplier_rccm = pinned(rccm.rule);
  }

  const niu = extractSupplierNiu(text);
  if (niu) {
    fields.supplier_niu = niu.value;
    provenance.supplier_niu = pinned(niu.rule);
  }

  const region = extractRegion(text);
  if (region) {
    fields.region = region.value;
    provenance.region = pinned(region.rule, 0.85);
  }

  const status = extractStatusKeywords(text);
  if (status) {
    fields.status_keywords = status.value;
    provenance.status_keywords = pinned(status.rule);
  }

  const esc = extractEscalationClause(text);
  if (esc) {
    fields.has_escalation_clause = esc.value;
    provenance.has_escalation_clause = pinned(esc.rule);
  }

  // Dates — labels that introduce the date in French procurement listings
  const awardDate = extractDate(
    text,
    ["date d'attribution", 'attribué le', 'attribue le', 'date attribution', 'awarded on'],
    'date.award',
  );
  if (awardDate) {
    fields.award_date = awardDate.value;
    provenance.award_date = pinned(awardDate.rule);
  }
  const closeDate = extractDate(
    text,
    [
      'date limite de dépôt',
      'date limite de depot',
      'date limite des offres',
      'clôture',
      'cloture',
      'closing date',
    ],
    'date.close',
  );
  if (closeDate) {
    fields.tender_close_date = closeDate.value;
    provenance.tender_close_date = pinned(closeDate.rule);
  }
  const pubDate = extractDate(
    text,
    ['date de publication', 'publié le', 'publie le', 'published on'],
    'date.publication',
  );
  if (pubDate) {
    fields.tender_publication_date = pubDate.value;
    provenance.tender_publication_date = pinned(pubDate.rule);
  }
  const effDate = extractDate(
    text,
    ["date d'effet", 'date effet', 'effective date', 'entrée en vigueur', 'entree en vigueur'],
    'date.effective',
  );
  if (effDate) {
    fields.effective_date = effDate.value;
    provenance.effective_date = pinned(effDate.rule);
  }

  // What's still unresolved — driven by which fields the deterministic pass
  // could not extract. The caller routes these to the LLM.
  const allKeys: ProcurementFieldKey[] = [
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
    'line_items',
    'status_keywords',
  ];
  const unresolved = allKeys.filter((k) => !(k in fields));

  return { fields, provenance, unresolved };
}

/** Exposed for property-based testing; do not use in production. */
export const __test_internals = {
  parseToIso,
  extractAmountXaf,
  extractBidderCount,
  extractProcurementMethod,
  extractRegion,
  PLAUSIBLE_MAX_XAF,
  PLAUSIBLE_MAX_BIDDERS,
  MAX_INPUT_CHARS,
};
