/**
 * Document content extractor — surfaces structured fields from OCR'd /
 * extracted text into the source-event payload, keyed by source_id +
 * event kind.
 *
 * Closes the production-input gap for two patterns whose adapters
 * (cour-des-comptes, minepat-bip) emit metadata-only events because
 * the structured fields live inside the linked PDFs:
 *
 *   - P-A-008 (suppressed-protest pattern) reads `audit_observation`
 *     events with `protest_disposition` payload. Cour des Comptes
 *     reports + protest-decision documents contain phrases like
 *     "rejet pour défaut de qualité", "irrecevable", "dismissed for
 *     lack of standing"; this module extracts the disposition string.
 *
 *   - P-D-005 (fabricated-progress) reads `investment_project` events
 *     with `progress_pct` payload. MINEPAT-BIP and MINTP progress
 *     reports use phrasing like "Exécution physique: 45 %",
 *     "Avancement physique: 60 %", "Physical progress: 35 percent".
 *
 * Pure function. No I/O. No clock. No randomness. Deterministic output.
 *
 * Hardening:
 *   - Bounded regex (no unbounded `.*`).
 *   - Closed allow-list of disposition tokens (no regex injection).
 *   - PLAUSIBLE_PCT cap on progress percentage.
 *   - Length-clamp on the output disposition string.
 *   - Returns `{}` (empty additions) when nothing matched — caller
 *     treats absence as absence; patterns short-circuit cleanly.
 */

const MAX_DISPOSITION_LEN = 200;
const MAX_TEXT_SCAN = 400_000; // ARMP/MINEPAT PDF OCR rarely exceeds 200 KB

/**
 * Closed allow-list of protest-disposition keywords. Each entry
 * (canonical, needles[]) captures a disposition class — the canonical
 * label is what we emit so downstream patterns see a stable
 * vocabulary even when source documents use different phrasings.
 */
const DISPOSITION_TOKENS: ReadonlyArray<{ canonical: string; needles: ReadonlyArray<string> }> = [
  {
    canonical: 'rejected',
    needles: ['rejet', 'rejet de la plainte', 'plainte rejetée', 'rejected', 'dismissed'],
  },
  { canonical: 'inadmissible', needles: ['irrecevable', 'inadmissible', 'jugée irrecevable'] },
  { canonical: 'partially_upheld', needles: ['partiellement fondée', 'partially upheld'] },
  { canonical: 'upheld', needles: ['fondée', 'plainte fondée', 'upheld', 'sustained'] },
  { canonical: 'withdrawn', needles: ['retirée', 'withdrawn', 'désistement'] },
];

/**
 * Source-event-kind → kind-specific extraction routine. Keyed off the
 * adapter source_id so the dispatch is direct and no router-level
 * misclassification can leak the wrong field type onto a payload.
 */
export interface DocContentInput {
  readonly sourceId: string;
  readonly eventKind: string; // SourceEventKind, kept loose for routing
  readonly ocrText: string;
}

export interface DocContentExtraction {
  /** Fields to merge into source.events.payload. Empty when nothing matched. */
  readonly additions: Record<string, unknown>;
  /** Per-field provenance for the audit chain. */
  readonly provenance: Record<string, string>;
}

export function extractDocContent(input: DocContentInput): DocContentExtraction {
  const text =
    input.ocrText.length > MAX_TEXT_SCAN ? input.ocrText.slice(0, MAX_TEXT_SCAN) : input.ocrText;

  const additions: Record<string, unknown> = {};
  const provenance: Record<string, string> = {};

  if (input.eventKind === 'audit_observation') {
    const disposition = extractProtestDisposition(text);
    if (disposition) {
      additions['protest_disposition'] = disposition.value;
      provenance['protest_disposition'] = `doc-content:${disposition.rule}`;
    }
  }
  if (input.eventKind === 'investment_project') {
    const progress = extractProgressPct(text);
    if (progress !== null) {
      additions['progress_pct'] = progress.value;
      provenance['progress_pct'] = `doc-content:${progress.rule}`;
    }
  }
  return { additions, provenance };
}

/**
 * Extract the disposition (rejected / inadmissible / etc.) from a
 * protest-decision document. First-match wins per the closed allow-
 * list ordering above.
 */
export function extractProtestDisposition(text: string): { value: string; rule: string } | null {
  const lower = text.toLowerCase();
  for (const tok of DISPOSITION_TOKENS) {
    for (const needle of tok.needles) {
      if (lower.includes(needle)) {
        return {
          value: tok.canonical.slice(0, MAX_DISPOSITION_LEN),
          rule: `disposition.${tok.canonical}`,
        };
      }
    }
  }
  return null;
}

/**
 * Extract a progress percentage from a project execution report.
 * Handles French ("Exécution physique: 45 %", "Avancement: 60%"),
 * English ("Physical progress: 35 percent"), and tolerates whitespace
 * variants and decimal points.
 *
 * Returns the highest plausible value found in the document — projects
 * sometimes mention phase-specific progress along with overall, and
 * the patterns key off the overall figure (which is typically the
 * largest reported).
 */
export function extractProgressPct(text: string): { value: number; rule: string } | null {
  // Bounded regex with global flag for matchAll. Non-greedy `.{0,60}?` gap
  // allows lot-numbers / colons / unit qualifiers between the cue word and
  // the percentage. The 60-char cap keeps backtracking bounded — no ReDoS.
  const cues: ReadonlyArray<{ rule: string; re: RegExp }> = [
    {
      rule: 'progress.exec-physique-fr',
      re: /(?:ex[ée]cution|avancement)\s+(?:physique|du\s+projet)\b.{0,60}?(\d{1,3}(?:[.,]\d{1,2})?)\s*%/gi,
    },
    {
      rule: 'progress.avancement-fr',
      re: /\bavancement\b.{0,30}?(\d{1,3}(?:[.,]\d{1,2})?)\s*%/gi,
    },
    {
      rule: 'progress.physical-en',
      re: /\b(?:physical\s+)?progress\b.{0,30}?(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:%|percent)/gi,
    },
    {
      rule: 'progress.naked-percent-with-context',
      re: /\b(?:taux|rate)\s+(?:d['' ]?ex[ée]cution|of\s+execution)\b.{0,30}?(\d{1,3}(?:[.,]\d{1,2})?)\s*%/gi,
    },
  ];

  let best: { value: number; rule: string } | null = null;
  for (const cue of cues) {
    for (const m of text.matchAll(cue.re)) {
      if (m && m[1]) {
        const n = Number.parseFloat(m[1].replace(',', '.'));
        if (Number.isFinite(n) && n >= 0 && n <= 100) {
          if (best === null || n > best.value) {
            best = { value: n, rule: cue.rule };
          }
        }
      }
    }
  }
  return best;
}
