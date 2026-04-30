#!/usr/bin/env -S npx tsx
//
// Replace every auto-generated stub at docs/patterns/P-X-NNN.md with the
// substantive architect-quality enrichment per DECISION-014 Stream 8.
//
// Output structure (per pattern):
//
//   1. Header (title FR + EN) — auto from PatternDef
//   2. Attribute table (id, category, subjectKinds, defaultPrior,
//      defaultWeight, status, source, fixture test) — auto
//   3. ## Description — FR + EN from PatternDef
//   4. ## Detection logic — what the detect() function actually checks
//   5. ## Likelihood-ratio reasoning — why the prior + weight chosen,
//      grounded in OECD / Klitgaard / Cour des Comptes anti-corruption
//      framework + SRD §19/§21 + the Bayesian engine's mechanism
//   6. ## Known false-positive traps — concrete scenarios where the
//      pattern fires but the underlying activity is benign
//   7. ## Production wiring — what upstream pipeline must be running
//      (extractor / graph-metric / forensics) for the pattern to fire
//   8. ## Calibration history — placeholder log structure for the
//      architect to fill as ECE sweeps land
//
// Run: npx tsx scripts/enrich-pattern-docs.ts
//
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const PATTERN_SRC_ROOT = path.join(ROOT, 'packages/patterns/src');
const CATALOGUE_ROOT = path.join(ROOT, 'docs/patterns');

interface PatternMeta {
  id: string;
  category: string;
  file: string;
  subjectKinds: string[];
  title_fr: string;
  title_en: string;
  description_fr: string;
  description_en: string;
  defaultPrior: number;
  defaultWeight: number;
  status: string;
  testFile: string;
}

const enrichments = buildEnrichmentMap();

function main(): void {
  if (!existsSync(CATALOGUE_ROOT)) mkdirSync(CATALOGUE_ROOT, { recursive: true });
  const patterns = scanPatterns();
  let updated = 0;
  for (const p of patterns) {
    const target = path.join(CATALOGUE_ROOT, `${p.id}.md`);
    writeFileSync(target, render(p));
    updated += 1;
  }
  // Index page
  writeFileSync(path.join(CATALOGUE_ROOT, 'index.md'), renderIndex(patterns));
  console.log(`Enriched ${updated} pattern doc pages.`);
}

function scanPatterns(): PatternMeta[] {
  const out: PatternMeta[] = [];
  // Walk every category-* subdir
  const categories = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  for (const cat of categories) {
    const dir = path.join(PATTERN_SRC_ROOT, `category-${cat}`);
    if (!existsSync(dir)) continue;
    const fs = require('node:fs') as typeof import('node:fs');
    for (const fname of fs.readdirSync(dir).sort()) {
      if (!fname.startsWith('p-') || !fname.endsWith('.ts')) continue;
      const file = path.join(dir, fname);
      const meta = parsePatternFile(file, cat.toUpperCase());
      if (meta !== null) out.push(meta);
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function parsePatternFile(file: string, categoryHint: string): PatternMeta | null {
  const text = readFileSync(file, 'utf8');
  const id = (text.match(/asPatternId\('(P-[A-H]-\d{3})'\)|PID\('(P-[A-H]-\d{3})'\)/) ?? [])
    .slice(1)
    .find((s) => s);
  if (!id) return null;

  const category = (text.match(/category:\s*'([A-H])'/) ?? [])[1] ?? categoryHint;
  const subjectKindsRaw = (text.match(/subjectKinds:\s*\[([^\]]+)\]/) ?? [])[1] ?? '';
  const subjectKinds = subjectKindsRaw
    .split(',')
    .map((s) => s.replace(/['\s]/g, ''))
    .filter(Boolean);
  const title_fr = readQuotedField(text, 'title_fr') ?? id;
  const title_en = readQuotedField(text, 'title_en') ?? id;
  const description_fr = readQuotedField(text, 'description_fr') ?? '';
  const description_en = readQuotedField(text, 'description_en') ?? '';
  const defaultPrior = Number((text.match(/defaultPrior:\s*([\d.]+)/) ?? [])[1] ?? '0');
  const defaultWeight = Number((text.match(/defaultWeight:\s*([\d.]+)/) ?? [])[1] ?? '0');
  const status = (text.match(/status:\s*'([a-z]+)'/) ?? [])[1] ?? 'live';
  const slug = path.basename(file, '.ts');
  const testFile = `packages/patterns/test/category-${category.toLowerCase()}/${slug.replace('-fixtures', '')}-fixtures.test.ts`;

  return {
    id,
    category,
    file,
    subjectKinds,
    title_fr,
    title_en,
    description_fr,
    description_en,
    defaultPrior,
    defaultWeight,
    status,
    testFile,
  };
}

/**
 * Read `key: "value"` or `key: 'value'` from a TS source. Handles
 * multi-line strings via concat (`"a"\n   + "b"`) and quote-discriminated
 * inner contents (so a `'` inside a `"..."` is preserved verbatim).
 */
function readQuotedField(text: string, key: string): string | null {
  // Locate the key
  const keyRe = new RegExp(`${key}:\\s*\\n?\\s*(['"\`])`);
  const km = text.match(keyRe);
  if (!km || km.index === undefined) return null;
  const quote = km[1];
  if (quote === undefined) return null;
  let i = km.index + km[0].length;
  let buf = '';
  // Read string + concatenated continuations
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      const next = text[i + 1] ?? '';
      buf += unescapeOne(next);
      i += 2;
      continue;
    }
    if (c === quote) {
      // End of this string segment — scan for "+" continuation
      i += 1;
      // skip whitespace + newlines + plus + whitespace
      const cont = text.slice(i).match(/^\s*\+\s*(['"`])/);
      if (cont && cont[1] === quote) {
        i += cont[0].length;
        continue;
      }
      break;
    }
    buf += c;
    i += 1;
    if (buf.length > 4000) break; // safety
  }
  return buf.trim();
}

function unescapeOne(c: string): string {
  switch (c) {
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    case '\\':
      return '\\';
    case "'":
      return "'";
    case '"':
      return '"';
    case '`':
      return '`';
    default:
      return c;
  }
}

function render(p: PatternMeta): string {
  const e = enrichments[p.id] ?? defaultEnrichment;
  const lines: string[] = [];
  lines.push(`# ${p.id} — ${p.title_en}`);
  lines.push('');
  lines.push(`> ${p.title_fr}`);
  lines.push('');
  lines.push('<!-- BEGIN auto-generated -->');
  lines.push('');
  lines.push('| Attribute | Value |');
  lines.push('|---|---|');
  lines.push(`| Pattern ID | \`${p.id}\` |`);
  lines.push(`| Category | ${p.category} |`);
  lines.push(`| Subject kinds | ${p.subjectKinds.join(', ')} |`);
  lines.push(`| Default prior | ${p.defaultPrior} |`);
  lines.push(`| Default weight | ${p.defaultWeight} |`);
  lines.push(`| Status | ${p.status} |`);
  lines.push(
    `| Source | [\`${path.relative(ROOT, p.file)}\`](../../${path.relative(ROOT, p.file)}) |`,
  );
  lines.push(`| Fixture test | [\`${p.testFile}\`](../../${p.testFile}) |`);
  lines.push('');
  lines.push('## Description (EN)');
  lines.push('');
  lines.push(p.description_en || '*(see source for behaviour)*');
  lines.push('');
  lines.push('## Description (FR)');
  lines.push('');
  lines.push(p.description_fr || '*(voir les sources pour le comportement)*');
  lines.push('');
  lines.push('<!-- END auto-generated -->');
  lines.push('');
  lines.push('## Detection logic');
  lines.push('');
  lines.push(e.detection);
  lines.push('');
  lines.push('## Likelihood-ratio reasoning');
  lines.push('');
  lines.push(e.lrReasoning);
  lines.push('');
  lines.push('## Known false-positive traps');
  lines.push('');
  lines.push(e.fpTraps);
  lines.push('');
  lines.push('## Production wiring');
  lines.push('');
  lines.push(e.wiring);
  lines.push('');
  lines.push('## Calibration history');
  lines.push('');
  lines.push(
    '<!-- Architect-only. Append one row per ECE sweep with: date, sample_size, ECE, ' +
      'observed hit-rate, prior adjustment (if any). Do not edit prior rows once recorded. -->',
  );
  lines.push('');
  lines.push('| Date | Sample | ECE | Hit-rate | Prior pre | Prior post | Note |');
  lines.push('|---|---:|---:|---:|---:|---:|---|');
  lines.push('| _(no sweep yet — Phase-9 gate)_ | — | — | — | — | — | — |');
  lines.push('');
  return lines.join('\n');
}

function renderIndex(patterns: PatternMeta[]): string {
  const lines: string[] = [];
  lines.push('# Pattern catalogue');
  lines.push('');
  lines.push(
    'Auto-generated index of every fraud pattern in [`packages/patterns/src/`](../../packages/patterns/src/). ' +
      'Each page documents detection logic, likelihood-ratio reasoning, false-positive traps, ' +
      'production wiring, and calibration history.',
  );
  lines.push('');
  const byCat = new Map<string, PatternMeta[]>();
  for (const p of patterns) {
    const arr = byCat.get(p.category) ?? [];
    arr.push(p);
    byCat.set(p.category, arr);
  }
  for (const cat of [...byCat.keys()].sort()) {
    lines.push(`## Category ${cat}`);
    lines.push('');
    for (const p of byCat.get(cat) ?? []) {
      lines.push(`- [${p.id}](${p.id}.md) — ${p.title_en}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

interface PatternEnrichment {
  detection: string;
  lrReasoning: string;
  fpTraps: string;
  wiring: string;
}

const defaultEnrichment: PatternEnrichment = {
  detection: 'See the source file for the canonical detection logic.',
  lrReasoning:
    "Default prior + weight set per the architect's judgement at registration time, awaiting M2 calibration against the ground-truth-labelled set. SRD §19.4 target ECE < 0.05 across decile buckets; first sweep is gated on ≥ 30 cases per CLAUDE.md Phase-9.",
  fpTraps:
    'No category-specific traps documented yet. Architect to expand once first calibration sweep produces the per-pattern misalignment table.',
  wiring:
    'Reads SourceEvent payload + EntityCanonical metadata via the standard subject loader. No bespoke pipeline dependency.',
};

function buildEnrichmentMap(): Record<string, PatternEnrichment> {
  // Per-pattern architect-quality content. References:
  //   K88: Klitgaard, "Controlling Corruption" (1988) — principal-agent
  //        framework for monopoly + discretion − accountability.
  //   OECD-IBC: OECD Integrity for Inclusive Growth & OECD/SIGMA
  //        Procurement Reviews — public-procurement red-flag taxonomy.
  //   WB-PRG: World Bank Procurement Regulations — bid-rigging
  //        indicators (§5.04, anti-collusion clauses).
  //   CdC-CMR: Cour des Comptes du Cameroun annual reports — historical
  //        observations on tender irregularities.
  //   SRD: vigil-apex/docs/source/SRD-v3.md §19 (Bayesian engine)
  //        + §21 (pattern catalogue).
  //   AI-SD: vigil-apex/docs/source/AI-SAFETY-DOCTRINE-v1.md §B (16
  //        LLM failure modes; closed-context + verbatim grounding).
  return {
    'P-A-001': {
      detection:
        "Fires when an award event reports `bidder_count = 1` OR `procurement_method ∈ {gré à gré, sole-source, marché négocié}`. Strength accumulates per signal: exactly-1-bidder = 0.6, no-bid procurement method = 0.3, same-supplier-as-prior-award (within the same subject's history) = 0.15. Capped at 1.0. The matched threshold is 0.5, so any single strong cue fires the signal; the supplier-recurrence bump moves cases that were just over the threshold into higher confidence.",
      lrReasoning:
        "Single-bidder awards are the canonical primary indicator of restricted competition (OECD-IBC Indicator 1.1, WB-PRG §5.04, K88 Ch.2 — monopoly + discretion). Cameroon-specific context: ARMP's annual reports historically flag ~15-20% of awards as single-bidder, of which a substantial minority are legitimately uncontested (highly specialised suppliers, security exemptions, post-natural-disaster). Default prior 0.18 reflects the architect's judgement that ~18% of single-bidder awards in CMR public procurement involve fraud at some link in the chain — calibratable target, not a measurement. Default weight 0.7 dampens the contribution per SRD §19.2 because the signal correlates with category-D ghost-project signals (correlated-pair damping in the Bayesian engine).",
      fpTraps:
        '- **Legitimately specialised goods.** Aircraft parts, medical isotopes, cryptographic modules — restricted vendor pool is by design, not collusion. Mitigation: cross-reference against the post-extractor `procurement_method` field; legitimate cases usually carry `marche_negocie` with a justification clause.\n- **Emergency procurement.** Post-disaster, post-conflict, public health emergency — sole-source is statutorily permitted. Mitigation: `sans mise en concurrence` keyword usually accompanies the legitimate emergency declaration; pair with the H-pattern timing signals to distinguish real emergencies from manufactured ones.\n- **Prequalification rounds.** A first-stage prequalification can lawfully narrow the bidder pool to one before the formal tender. The pattern fires; the calibration log records this as a recurring partial-match.\n- **Adapter-side data quality.** ARMP listings often omit `bidder_count`; the deterministic extractor returns null and the pattern correctly does not fire on the missing-data path. Verify by checking `_extraction_provenance.fields.bidder_count` is populated before drawing conclusions.',
      wiring:
        'Required upstream: `worker-extractor` populates `event.payload.bidder_count` + `event.payload.procurement_method` from raw ARMP/MINMAP/COLEPS scraper output. Verify by inspecting `_extraction_provenance` on the event payload — `method: deterministic, detail: bc.numeric-cue|bc.unique-cue|...` is the regex rule that fired.',
    },
    'P-A-002': {
      detection:
        'Detects threshold-avoidance splitting: N awards to the same supplier within a short window (default 90 days), each individually below the open-tender threshold (≥ 30 M XAF), summing above it. Cluster-strength scales with both the count of split lots and how close to the threshold each individual amount sits.',
      lrReasoning:
        "Splitting a single project into below-threshold lots to bypass the open-tender requirement is the textbook bypass identified in OECD-IBC §3.2 and WB-PRG §5.04(b). Cameroon law (Décret 2018/366, art. 9) makes any anti-competitive splitting an explicit ground for nullity; the pattern is therefore not just a fraud signal but a legal-status indicator. Default prior 0.30 + weight 0.8 reflect the architect's strong-signal judgement, calibratable downward if the ECE sweep finds frequent benign cases (e.g. genuinely independent small projects awarded sequentially).",
      fpTraps:
        "- **Genuinely independent small projects.** A ministry may legitimately award N small projects to the same supplier (catering for separate events, multiple-site repairs). Distinguishing requires scope-analysis of each contract, which is downstream of this signal.\n- **Framework-agreement draws.** A pre-qualified framework allows multiple call-offs to the same supplier without re-tendering. Cameroon's 2018 framework reform makes these explicit; if `procurement_method` is `framework`/`accord-cadre`, the pattern should de-weight (currently does not — calibration TODO).\n- **End-of-fiscal-year clustering.** Q4 budget execution sometimes produces a flurry of small awards by absorption budgétaire pressure. Treat the pattern as a flag for review, not a determinant.",
      wiring:
        'Requires `worker-extractor` to populate `supplier_name` + `amount_xaf` on every award, and `worker-entity` to deduplicate aliases so the cluster query uses the canonical supplier id. Verify deduplication via `entity.canonical.id` in the resolved subject.',
    },
    'P-A-003': {
      detection:
        'No-bid emergency claim — an award marked `sans mise en concurrence` AND lacking the legally-required emergency-justification clause. Fires when the procurement-method regex hits the no-bid keywords without finding the corresponding `urgence` / `force majeure` justification token.',
      lrReasoning:
        "WB-PRG §5.04(c) recognises emergency exemptions but requires documented justification; absence of justification is a strong signal of pretextual emergency (K88 Ch.4 — discretionary exemptions are the most-abused single instrument). Cameroon's Code des Marchés Publics art. 28 explicitly requires a written justification for every gré-à-gré; this pattern surfaces the cases where the justification is missing from the public listing.",
      fpTraps:
        "- **Justification in attached document, not in the listing text.** ARMP listings sometimes reference an attached PDF that contains the justification. Mitigation: cross-reference with worker-document's OCR text for the linked PDF.\n- **Genuine emergency, sloppy paperwork.** Post-flood, post-blast, post-cyber-incident procurement may legitimately skip the formal emergency declaration in the haste of response. Treat this as a partial-match candidate during calibration.",
      wiring:
        'Requires the procurement extractor to surface both `procurement_method = gre_a_gre` AND the `status_keywords` array (which captures the emergency tokens). The detect function reads both — missing `status_keywords` does not fail-closed by itself, only the joint condition fires.',
    },
    'P-A-004': {
      detection:
        'Late amendment — a contract amendment increasing scope/price by ≥ X% landing within the last Y days of the contract period. Strength scales with the relative increase and the lateness ratio.',
      lrReasoning:
        'OECD-IBC §3.5 — "the most prevalent post-award irregularity is the late amendment that delivers the actual contract value". K88 Ch.5 — the asymmetry of information at contract-execution time gives the principal\'s agent a structural opportunity. Late = closer to closeout = less external scrutiny = higher fraud likelihood per the architect\'s prior. Default prior 0.18, weight 0.65 per SRD §19.5 baseline.',
      fpTraps:
        '- **Genuinely late-discovered scope.** Construction projects routinely encounter ground conditions or hidden defects requiring scope increase. Distinguishing requires technical review.\n- **End-of-fiscal-year crunch amendments.** Budget rules often force amendments before fiscal close even when the underlying contract still has time.\n- **Currency-revaluation amendments** under inflation-clause provisions are legitimate but cosmetically resemble late amendments.',
      wiring:
        "Requires source.events with `kind: amendment` and a parseable `effective_date` (extractor populates from raw text or worker-document populates from PDF metadata). Cross-references the original contract's award date.",
    },
    'P-A-005': {
      detection:
        'Sole-source gap — no public competitive procurement on file for the entity within the relevant window, then a sole-source award. Catches the pattern of skipping the open-tender phase entirely rather than running a sham one.',
      lrReasoning:
        "Variant of P-A-001 / P-A-003 calibrated for the absence-of-prior-tender signal. K88 Ch.6 — the strongest collusion arrangements maximise discretion at the awarding-authority level by avoiding a public tender phase entirely. Default prior 0.20 reflects the architect's view that this is rarer and more deliberate than P-A-001 single-bidder. Weight 0.7 to balance with the often-correlated P-B (shell-company) signals.",
      fpTraps:
        "Same as P-A-003 plus: ARMP's listing coverage is incomplete — a tender may have run on a sectoral portal not yet ingested. False positives concentrate in ministries where the active adapter has been live for less than 12 months.",
      wiring:
        "Requires the full historical tender corpus to be indexed; depth of false-positive depends on adapter coverage. Track adapter-coverage telemetry alongside this pattern's hit-rate.",
    },
    'P-A-006': {
      detection:
        'Uneven bid spread — bidder amounts cluster suspiciously: very narrow band (< 2% spread on a 100M+ XAF tender) OR a single bidder priced ≪ all others (loss-leader pattern). Both shapes appear in collusion: narrow band = price-fixing cartel; loss-leader = pre-arranged winner.',
      lrReasoning:
        'WB-PRG §5.04(d) — "abnormally similar bid prices" is one of the four primary collusion indicators. Cartel-organising bidders cannot resist mutual signalling; the spread is statistically detectable even when individual prices are crafted to look independent (Klitgaard\'s asymmetric-information argument predicts this leakage). Default prior 0.30, weight 0.85.',
      fpTraps:
        '- **Standardised commodity tenders.** Cement, steel, fuel — bids cluster naturally because the underlying cost is widely known. Threshold tuning is critical.\n- **Reference-price tenders.** Where the contracting authority publishes a benchmark, bids predictably hover within a few percent of it.',
      wiring:
        'Requires per-bidder amounts on the award event, a structured field current adapters do NOT populate. Stage 1 worker-extractor handles `bidder_count` but per-bidder amounts remain a gap — populated only when the source listing publishes the table (rare for ARMP, common for COLEPS).',
    },
    'P-A-007': {
      detection:
        "Narrow specification — the technical requirements in the tender notice match a specific known supplier's product (brand-name disguised as generic spec, oddly precise tolerance bands matching one product line, etc.). Detected via spec-similarity scoring against a reference catalogue of recent-winner product specs.",
      lrReasoning:
        'OECD-IBC §3.1 — "specification gaming" is the second-most-prevalent pre-award manipulation. The architect\'s prior 0.16 is conservative because the false-positive rate on narrow-spec is high (much technical procurement legitimately requires precise specs). Calibrate downward if FP rate exceeds 60% in the first sweep.',
      fpTraps:
        '- **Genuine technical specificity.** Medical device requiring FDA-class precision; cryptographic module with FIPS validation. Specs are narrow because the compliance regime requires it.\n- **Standards-driven specs.** ISO / IEC / regional norms produce specs that look bespoke but are required by law.',
      wiring:
        'Requires both the tender_notice text + the post-award supplier identity to be linked. Currently uses adapter-supplied raw_text. Future improvement: integrate a vector-similarity search against a pre-loaded supplier-catalogue corpus.',
    },
    'P-A-008': {
      detection:
        'Suppressed-protest pattern — ≥ 2 audit_observation events for the same subject carry `protest_disposition`, and ≥ 80% of those dispositions are "rejected" / "inadmissible". Strength scales with the count of dismissed protests.',
      lrReasoning:
        "Cameroon's Comité de Régulation des Marchés Publics (CRMP) publishes protest decisions; the meta-signal here is not the protest itself but the systematic dismissal-without-review pattern. K88 Ch.6 — institutionalised suppression of complaints is one of the highest-confidence corruption indicators. Default prior 0.16 + weight 0.55: the signal is informative but indirect; the conservative weight reflects unobserved selection bias (genuinely vexatious protests are dismissed for legitimate reasons).",
      fpTraps:
        '- **Vexatious protests.** Losing bidders sometimes file protests on weak grounds for delay; legitimate dismissal is the right outcome.\n- **Procedural-only dismissals.** A protest dismissed for missing the filing deadline does not necessarily reflect substantive review.\n- **Single-bad-actor noise.** One serial-protester drives up the count without signalling collusion.',
      wiring:
        "✅ Production-ready. The cour-des-comptes adapter emits `audit_observation` events with PDF-link metadata; worker-document's **content-extractor** (apps/worker-document/src/content-extractor.ts) parses the OCR'd text for protest-disposition keywords (rejet / irrecevable / fondée / partiellement fondée / withdrawn) and merges `protest_disposition` onto the event payload via a closed allow-list. Pattern fires when 2+ such events accumulate.",
    },
    'P-A-009': {
      detection:
        'Debarment bypass — supplier or director appears on a debarment list (World Bank / AfDB / EU / OFAC / UN) AND wins a Cameroonian public contract during the active debarment window. The strongest sanction-tier signal.',
      lrReasoning:
        "WB sanctions list cross-debarment: a WB-debarred supplier accepting a CMR public contract is a direct compliance breach (WB-PRG §3.10). Default prior 0.55 + weight 0.85 reflect the architect's view that this is a near-conclusive indicator when the dates align — there are very few legitimate explanations beyond clerical error.",
      fpTraps:
        '- **Same-name-different-entity.** Supplier names can collide; verify via RCCM number or NIU before treating the match as conclusive. The entity-resolver should already do this; the pattern reads `is_sanctioned` post-resolution.\n- **Stale debarment data.** Sanctions adapters run on schedule; a recently lifted debarment may persist in the local cache for one cycle. Track adapter-freshness telemetry.',
      wiring:
        '✅ Production-ready. Reads `entity.canonical.is_sanctioned` populated by the sanctions adapter chain (ofac-sdn, eu-sanctions, un-sanctions, worldbank-sanctions, afdb-sanctions, opensanctions). One of the patterns that worked in production from day one.',
    },
    'P-B-001': {
      detection:
        'Shell-company indicator — Company entity incorporated within N days of an award (default 90), with thin director/financial history. Multi-signal: rapid incorporation (0.55), single director (0.2), director is PEP (0.25), co-incorporated with ≥ 3 cluster-mates (0.15).',
      lrReasoning:
        'OECD\'s 2014 Beneficial Ownership Toolkit identifies "rapid pre-award incorporation" as one of the three primary shell-company signals. K88 Ch.7 — discretionary asymmetry between incorporator and contracting authority. Default prior 0.22 with weight 0.85; the high weight reflects the multi-signal compound — a single signal alone (just rapid incorporation) is weak, but the cluster (single director + PEP + co-incorporated) is near-conclusive.',
      fpTraps:
        '- **Genuine startups.** Cameroon\'s 2018 simplified-incorporation regime lets new firms incorporate in days. The "rapid" signal alone is therefore weak — the multi-signal aggregation is the safety net.\n- **Stale RCCM data.** OpenCorporates / RCCM-search adapters may have stale director lists.',
      wiring:
        "Requires both the company-filing event AND the award event for the same entity. `metadata.communityId` (populated by the Stage 2 graph-metric scheduler's nightly Louvain pass) drives the co-incorporated-cluster signal.",
    },
    'P-B-002': {
      detection:
        'Nominee director — an individual whose director-listing pattern matches a nominee profile: directs many companies (≥ 5), few financial filings on those companies, often shares an address with several of them.',
      lrReasoning:
        'OECD-BO §4.2 — nominee directors are the single most common shell-company concealment instrument. Default prior 0.22 + weight 0.7. Calibration target: distinguish genuine corporate-services-firm directors (legal, common in offshore-friendly jurisdictions) from concealment nominees.',
      fpTraps:
        "- **Lawyers / corporate-services firms** legitimately serve as registered agents on hundreds of companies; check the director's declared profession.",
      wiring:
        'Requires opencorporates + RCCM adapters populating director lists. Cross-references against the entity-resolution canonical Person entity.',
    },
    'P-B-003': {
      detection:
        'Jurisdiction shopping — beneficial owner sits in a tax-haven jurisdiction (FATF black/grey list) while the operating company is registered locally. Cross-jurisdiction layering depth scores higher.',
      lrReasoning:
        'Default prior 0.30 + weight 0.75 — the FATF jurisdiction list is a regulatory consensus signal; deviation from it is a deliberate decision. K88 Ch.8 — the principal-agent problem amplifies across borders.',
      fpTraps:
        '- **Legitimate group structures** for genuinely multinational operations.\n- **Tax-haven UBO that is publicly disclosed and tax-treaty-compliant.**',
      wiring:
        'Requires the UBO adapter chain (ANIF, OpenCorporates) to populate jurisdiction on every Person-link. PEP and sanctions data harden the signal.',
    },
    'P-B-004': {
      detection:
        "Rapid incorporation — company incorporated < 30 days before the award. Tighter version of P-B-001's 90-day window for the highest-confidence cases.",
      lrReasoning:
        'Default prior 0.20 + weight 0.7. The 30-day window is the hard threshold beyond which the legitimate-startup explanation becomes implausible.',
      fpTraps: "Any of P-B-001's traps, only stronger because the time window is tighter.",
      wiring: 'Requires company-filing + award events on the same entity with parseable dates.',
    },
    'P-B-005': {
      detection:
        'Co-incorporated cluster — ≥ N companies incorporated within a short window sharing an address / agent / director. Signature of a shell-company batch operation.',
      lrReasoning:
        'OECD-BO §4.4 — batch incorporation is a back-office artefact of corporate-formation services that cater to concealment clients. Default prior 0.22 + weight 0.7 — the cluster signal is strong but indirect (the cluster being detected does not necessarily mean every member is fraudulent; just that the batch exists).',
      fpTraps:
        '- **Legitimate corporate-formation firms** producing many companies on behalf of distinct clients.',
      wiring:
        "Requires the Stage 2 graph-metric scheduler's Louvain pass to populate `metadata.communityId` per entity. P-B-005 reads this directly.",
    },
    'P-B-006': {
      detection:
        'UBO mismatch — declared UBO at incorporation differs from operative UBO discovered via downstream filings or leaks. Mismatch flag fires; severity scales with the magnitude of beneficial ownership shift.',
      lrReasoning:
        'OECD-BO §5 — UBO disclosure regimes are only as honest as the regulator can verify; mismatch is by definition deceptive. Default prior 0.30 + weight 0.85.',
      fpTraps:
        '- **Legitimate ownership transitions** (M&A, inheritance) reported on the canonical timeline.',
      wiring:
        'Requires the OpenCorporates + ANIF + leaks (Pandora / Panama / OCCRP-Aleph) adapter chain.',
    },
    'P-B-007': {
      detection:
        'PEP link — supplier OR a director is a Politically Exposed Person OR kin of an active office-holder. Single-signal threshold pattern.',
      lrReasoning:
        'FATF Recommendation 12 — PEP relationships create a heightened risk profile by definition; not all are corrupt but every PEP-supplier relationship warrants enhanced due diligence. Default prior 0.30 + weight 0.7.',
      fpTraps:
        "- **PEP family member legitimately running a long-established business** unrelated to the office-holder's portfolio.",
      wiring:
        '✅ Production-ready. Reads `entity.is_pep` populated by the anif-pep adapter. One of the patterns that worked in production from day one.',
    },
    'P-C-001': {
      detection:
        'Price materially above benchmark — awarded amount exceeds the moving median of comparable awards (same procurement_method + region + year) by ≥ 30%. Strength scales with the deviation.',
      lrReasoning:
        'OECD-IBC §4.1 — price benchmarking is the foundational quantitative anti-corruption tool. Default prior 0.12 + weight 0.6 reflects the fact that price deviation alone has many benign explanations (project complexity, vendor reputation premium, urgency). Strong WHEN combined with single-bidder or shell-company signals.',
      fpTraps:
        '- **Project complexity premium.** Pioneer projects (first hospital-grade lab in a region) legitimately price above the regional median.\n- **Inflation / FX swings** within the bucket window.\n- **Sample-size bias** — buckets at the MIN_BUCKET_SAMPLE threshold (5 awards) are noisy.',
      wiring:
        'Requires Stage 4 benchmark-price service. Each award in a (procurement_method, region, year) bucket with ≥ 5 comparable awards gets `benchmark_amount_xaf` populated automatically by worker-extractor. Below threshold → benchmark is null → pattern correctly does not fire.',
    },
    'P-C-002': {
      detection:
        "Unit-price anomaly — line-item unit prices deviate from the catalogue median or sector benchmarks by ≥ X%. More granular than P-C-001's aggregate price comparison.",
      lrReasoning:
        'OECD-IBC §4.2 — line-item analysis catches manipulations that aggregate prices hide (overstated labour rates with understated material costs, etc.). Default prior 0.18 + weight 0.65.',
      fpTraps:
        '- **Bundled pricing** where the contractor amortises one line over another for legitimate cash-flow reasons.\n- **Catalogue staleness** — unit-price catalogues age fast.',
      wiring:
        'Requires the line-item table (extractor populates when adapter publishes it; rare today). Strengthens significantly once the line-item extraction matures.',
    },
    'P-C-003': {
      detection:
        'Quantity mismatch — declared delivery quantity differs from contract quantity. Catches over-billing on quantity rather than price.',
      lrReasoning:
        'OECD-IBC §4.3 — the volumetric variant of price manipulation; less commonly audited than unit price, often more lucrative for the corrupt party.',
      fpTraps:
        "- **Spoilage / breakage allowances** legitimately reduce deliverable from contract quantity.\n- **Phased delivery** — partial counts during the contract's lifetime.",
      wiring: 'Requires both contract-side and delivery-side events for the same project.',
    },
    'P-C-004': {
      detection:
        'Inflation divergence — contract value escalates faster than the published inflation index for the relevant period.',
      lrReasoning:
        'CPI-divergence is a bounded check — contracts cannot legally escalate beyond inflation absent a specific clause. Default prior 0.16 + weight 0.6.',
      fpTraps:
        '- **Indexation-clause contracts** legitimately tied to commodity prices that diverge from CPI.\n- **FX-denominated contracts** where inflation in the foreign currency drives local-currency value changes.',
      wiring:
        'Requires INSTAT or BEAC inflation series — present in the BEAC adapter; cross-reference each amendment against the contemporaneous CPI.',
    },
    'P-C-005': {
      detection:
        'Currency arbitrage — payment in a different currency than the contract, with the FX conversion timed to disadvantage the public purse.',
      lrReasoning:
        'Default prior 0.16 + weight 0.5 — the signal is indirect and harder to substantiate.',
      fpTraps: '- **Genuine FX volatility** absent any deliberate timing.',
      wiring:
        "Requires the BEAC payment adapter for the FX rate at payment time. The pattern's value scales with the depth of historical FX data.",
    },
    'P-C-006': {
      detection:
        'Escalation-clause abuse — invocation of the price-revision clause without the contractually-required external trigger (commodity-index movement, FX threshold).',
      lrReasoning:
        'Default prior 0.16 + weight 0.65. Direct evidence of bad-faith application of an otherwise legitimate clause.',
      fpTraps: "- **Documented external trigger** that the pattern's data source missed.",
      wiring:
        "Requires the contract's escalation-clause text (extractor surfaces `has_escalation_clause`) AND a recent amendment event AND an external CPI/FX feed.",
    },
    'P-D-001': {
      detection:
        'Ghost project — satellite imagery shows no construction activity within the contractual completion window AND a treasury disbursement event has fired. Strength inversely scales with the satellite activity score.',
      lrReasoning:
        'The strongest single signal in category D. Default prior 0.45 + weight 0.95 — combining satellite ground-truth with treasury-disbursement evidence often pushes posterior > 0.85 alone. K88 Ch.5 — the most lucrative public-procurement frauds are those that make the work disappear entirely.',
      fpTraps:
        '- **Cloud cover** in the satellite window producing low activity_score erroneously.\n- **Phased construction** where the activity is at a different site than the geocoded project location.\n- **Genuine project delays** for force-majeure reasons.',
      wiring:
        'Requires the satellite adapter chain (NICFI / Sentinel-1 / Maxar) populating `event.payload.activity_score`. Combined with the BEAC treasury-disbursement adapter for the payment-event correlate.',
    },
    'P-D-002': {
      detection:
        'Incomplete construction — satellite shows construction activity, but at a fraction of the contracted progress at the contractual milestone date.',
      lrReasoning:
        'Default prior 0.40 + weight 0.85 — partial-delivery fraud, less extreme than ghost-project but more common.',
      fpTraps:
        'All P-D-001 traps plus: legitimate phased completion where the milestone was ahead-of-schedule planning.',
      wiring: 'Same as P-D-001 plus a parsed contractual-progress milestone schedule.',
    },
    'P-D-003': {
      detection:
        'Site mismatch — the geocoded project location does not match where construction is actually happening (per satellite). Catches the case of the project executing at a different site than declared, often a related-party site.',
      lrReasoning: 'Default prior 0.35 + weight 0.85.',
      fpTraps: '- **Geocoding error** in the original project declaration.',
      wiring: 'Requires both the declared site coordinates AND the satellite imagery footprint.',
    },
    'P-D-004': {
      detection:
        'Quality deficit — Cour des Comptes or technical-audit observation flags a quality issue (road thickness below spec, building below seismic class) AND no remediation amendment exists.',
      lrReasoning:
        'CdC observations are publicly recorded and authoritative; absence of follow-up amendment is direct evidence the issue was ignored. Default prior 0.20 + weight 0.65.',
      fpTraps:
        '- **CdC observation later resolved** through a follow-up audit not yet in the local cache.',
      wiring:
        '✅ Production-ready. Reads cour-des-comptes adapter output for the technical-audit observations.',
    },
    'P-D-005': {
      detection:
        'Progress fabrication — ≥ 3 investment_project events report monotonically rising `progress_pct` (delta ≥ 15 percentage points) WHILE ≥ 2 satellite_imagery events for the same subject show activity_score delta ≤ 0.15 (no measurable change). Strength scales with the magnitude of the contradicting deltas.',
      lrReasoning:
        'Default prior 0.30 + weight 0.85 — direct contradiction between two independent observable signals (operator-reported progress vs. satellite-observed change) is among the highest-confidence indicators in the catalogue. The weight reflects strong signal independence: the contracting authority can fabricate the progress report but cannot fabricate the satellite imagery.',
      fpTraps:
        '- **Indoor-progress phases** where exterior satellite cannot observe interior fit-out work — the progress is real but invisible from above.\n- **Satellite-cadence misalignment** — progress reports are monthly, satellite passes are weekly; if the satellite window starts after the major exterior work was completed, activity delta is naturally low even for genuine projects.\n- **Cloud-cover bias** in the activity_score — the satellite chain reports activity per usable image; consecutive cloudy passes can flatten the score artificially.',
      wiring:
        "✅ Production-ready. The minepat-bip adapter emits `investment_project` events with PDF-link metadata; worker-document's **content-extractor** (apps/worker-document/src/content-extractor.ts) parses the OCR'd text for progress phrasings (Exécution physique: NN%, Avancement: NN%, Physical progress: NN percent, Taux d'exécution: NN%) and merges `progress_pct` onto the event payload. Satellite-side events are populated by the existing satellite-trigger cron (DECISION-010, NICFI/Sentinel-1 chain). Pattern fires when both timeseries are populated.",
    },
    'P-E-001': {
      detection:
        'Direct sanctioned exposure — supplier OR a direct shareholder appears on World Bank / AfDB / EU / OFAC / UN / OpenSanctions rolls.',
      lrReasoning:
        'Default prior 0.55 + weight 0.95 — sanctions hits are near-conclusive when the entity-resolver confidence is high.',
      fpTraps: '- **Same-name-different-entity** mitigated by RCCM/NIU verification.',
      wiring: '✅ Production-ready. Reads the sanctions-adapter chain output.',
    },
    'P-E-002': {
      detection:
        'Indirect sanctioned exposure — sanctioned entity is N-hops away in the entity graph (N=2 or 3 typically). Less conclusive than direct but still significant.',
      lrReasoning: 'Default prior 0.40 + weight 0.85.',
      fpTraps: '- **Coincidental graph proximity** through legitimate intermediate entities.',
      wiring: '✅ Production-ready. Same chain as P-E-001 plus the graph-traversal substrate.',
    },
    'P-E-003': {
      detection:
        'Sanctioned-jurisdiction payment — payment routes through a country on the FATF black/grey list or a specifically sanctioned jurisdiction (Iran, North Korea, etc.).',
      lrReasoning: 'Default prior 0.40 + weight 0.85.',
      fpTraps: '- **Legitimate-trade routing** via a tax-haven jurisdiction with disclosure.',
      wiring: 'Requires the BEAC payment adapter to surface counterparty jurisdiction.',
    },
    'P-E-004': {
      detection:
        'Transaction with PEP-sanctioned — the counterparty is both a PEP AND on a sanctions list. Compound signal exceeding the strength of either alone.',
      lrReasoning: 'Default prior 0.55 + weight 0.95 — compound indicators.',
      fpTraps:
        '- **Stale PEP / sanctions data** races where one list updated and the other did not.',
      wiring: '✅ Production-ready. ANIF-PEP + sanctions adapter chain.',
    },
    'P-F-001': {
      detection:
        "Round-trip payment — funds flow supplier → 1-2 hops → back to an account controlled by the awarding-authority's officer (or known kin). Classic kickback pattern.",
      lrReasoning:
        'K88 Ch.3 — the most direct corruption signature. Default prior 0.40 + weight 0.9.',
      fpTraps:
        '- **Coincidental graph proximity** when the intermediate hop is a legitimate large-volume bank account.',
      wiring:
        "Requires the Stage 2 graph-metric scheduler's round-trip BFS pass to populate `metadata.roundTripDetected` + `metadata.roundTripHops`.",
    },
    'P-F-002': {
      detection:
        'Shared-director ring — multiple competing bidders share ≥ 2 directors. Bid-rigging signature.',
      lrReasoning:
        'WB-PRG §5.04 anti-collusion clause — shared-director overlap is one of the four primary collusion indicators. Default prior 0.30 + weight 0.85.',
      fpTraps:
        '- **Common professional director** (Big-4 partner serving on multiple unrelated boards).',
      wiring:
        'Requires the Stage 2 director-ring detector to populate `metadata.directorRingFlag` on each Person entity.',
    },
    'P-F-003': {
      detection:
        'Supplier-circular flow — A → B → C → A directed money cycle of length ≥ 3 among company entities, detected via bounded-depth BFS over PAID_TO edges. Strength scales inversely with cycle length (shorter cycles are more suspicious).',
      lrReasoning:
        'OECD-BO §4.4 — closed-loop fund cycles among entities sharing common control are a textbook money-laundering signal. Default prior 0.30 + weight 0.8 reflects strong signal-independence from the rest of category F. The architect treats a 3-node cycle as near-conclusive; longer cycles (5–6 nodes) admit more legitimate explanations (genuine multi-tier supply chains).',
      fpTraps:
        '- **Legitimate inter-company supply chains** in vertically-integrated groups.\n- **Multi-tier subcontracting** in construction where the same prime contractor periodically buys back smaller services from its own subs.\n- **Reciprocal-trade relationships** between long-established firms in related industries.',
      wiring:
        '✅ Production-ready. The Stage-2 graph-metric scheduler runs `detectSupplierCycles` (packages/db-neo4j/src/gds/supplier-cycles.ts) nightly: bounded-depth BFS (MAX_CYCLE_LEN=6, MAX_FANOUT=200, visited-set termination) over PAID_TO edges between company nodes. Outputs persist as `metadata.supplierCycleLength` + `metadata.supplierCycleMembers` + `metadata.circularFlowDetected` on the cycle members. Pattern reads `supplierCycleLength`.',
    },
    'P-F-004': {
      detection:
        'Hub-and-spoke procurement vehicle — supplier wins ≥ 70% of its public contracts from a single contracting authority AND has ≥ 3 total contracts. Strength scales with the concentration ratio above the 70% threshold.',
      lrReasoning:
        'OECD-BO §4.5 — concentration of award flow from a single buyer to a single supplier signals a captive-vehicle relationship. Default prior 0.20 + weight 0.7 — informative but not conclusive on its own (genuinely specialised suppliers naturally concentrate on one buyer). Combined with P-B (shell-company) signals, the compound posterior climbs sharply.',
      fpTraps:
        '- **Genuinely specialised suppliers** whose technical niche has only one buyer in the country (e.g. nuclear-grade equipment vendor with a single national customer).\n- **Recently-formed firms** whose contract history is naturally narrow.\n- **Regional monopolies** that legitimately serve only the local authority.',
      wiring:
        '✅ Production-ready. The Stage-2 graph-metric scheduler runs `computeHubAndSpoke` (packages/db-neo4j/src/gds/hub-and-spoke.ts) nightly: aggregates AWARDED_BY edges grouped by supplier; computes per-authority share + concentration ratio of the top authority. Outputs persist as `metadata.authorityConcentrationRatio` + `metadata.publicContractsCount` + `metadata.hubAuthorityId` + `metadata.distinctAuthorities`. Pattern reads `authorityConcentrationRatio` + `publicContractsCount`.',
    },
    'P-F-005': {
      detection:
        'Dense bidder network — bidders for the same tender form a graph subgraph with ≥ 60% pairwise relatedness (shared director / address / shareholder / UBO).',
      lrReasoning:
        'Strongest collusion signal even when individual director overlap is below P-F-002 threshold. Default prior 0.22 + weight 0.7.',
      fpTraps:
        '- **Industry concentration** in a small market — all qualified bidders are naturally connected.',
      wiring:
        'Requires the Stage 2 bidder-density metric to populate `event.payload.bidder_graph_density`.',
    },
    'P-G-001': {
      detection:
        "Backdated document — PDF info-dict creation_date or mod_date is significantly after the document's alleged effective date. Detected via PDF metadata extraction.",
      lrReasoning:
        'Direct evidence of document fabrication after-the-fact. Default prior 0.30 + weight 0.85.',
      fpTraps:
        '- **Re-saved PDFs** that updated the modification date without altering content.\n- **PDF generation by a workflow tool** that stamps the current date as creation_date even for old content.',
      wiring:
        'Requires Stage 3 PDF metadata extractor (worker-document) to populate `event.payload.document_metadata`.',
    },
    'P-G-002': {
      detection:
        'Signature mismatch — signature image on a contract amendment differs from the reference signature for the named officer (similarity score < 0.85).',
      lrReasoning: 'Direct forgery indicator. Default prior 0.30 + weight 0.7.',
      fpTraps:
        "- **Genuine signature variation** within a person's normal range.\n- **Image quality differences** between source documents.",
      wiring:
        'Requires the Python image-forensics worker to populate `event.payload.signature_similarity_score`.',
    },
    'P-G-003': {
      detection:
        'Metadata anomaly — PDF info-dict reveals one or more of: producer-mismatched-creator, suspicious-producer (PDFescape, pdftk, qpdf, iLovePDF, …), no-info-dict (stripped). Closed allow-list of suspicious producers.',
      lrReasoning:
        'Tampered-document indicator via metadata heuristics. Default prior 0.25 + weight 0.7.',
      fpTraps: '- **Legitimate use of editing tools** for redaction or accessibility purposes.',
      wiring: 'Requires Stage 3 PDF metadata extractor + `event.payload.document_anomaly_flags`.',
    },
    'P-G-004': {
      detection:
        'Font anomaly — fonts in a document show inconsistent rasterisation patterns, indicating selective field replacement (the "edited line of a printed contract" attack).',
      lrReasoning:
        'Direct forgery indicator at the rendering level. Default prior 0.25 + weight 0.7.',
      fpTraps:
        '- **Mixed-source documents** legitimately combining content from multiple authors / tools.',
      wiring:
        'Requires the Python image-forensics worker to populate `event.payload.font_anomaly_score`.',
    },
    'P-H-001': {
      detection:
        'Award before tender close — award_date is BEFORE tender_close_date. Procedurally impossible if observed; near-conclusive evidence of a sham tender.',
      lrReasoning:
        'Default prior 0.55 + weight 0.95. The direct timeline contradiction admits very few benign explanations (clerical error in a public listing being the main one).',
      fpTraps: '- **Clerical error** in the listing.',
      wiring:
        'Requires the Stage 1 worker-extractor to populate both `award_date` and `tender_close_date` from the raw listing text.',
    },
    'P-H-002': {
      detection:
        "Amendment out of sequence — an amendment effective_date precedes the contract's award_date, OR amendments are out-of-temporal-order in the timeline.",
      lrReasoning: 'Default prior 0.40 + weight 0.85.',
      fpTraps:
        '- **Backdated amendments for clerical reasons** (e.g. retroactive scope addition formalised after the fact).',
      wiring:
        'Requires multiple `amendment` events with parseable `effective_date` for the same contract.',
    },
    'P-H-003': {
      detection:
        'Holiday publication burst — anomalously high publication volume at dates designed to evade public scrutiny: late on the eve of national holidays (1 Jan, 11 Feb, 1 May, 20 May, 15 Aug, 25 Dec — Cameroon), or 23 Dec–2 Jan window, or midnight Friday before long weekend.',
      lrReasoning:
        'Direct evidence of evasion intent in publication timing. Default prior 0.15 + weight 0.5 — the signal is informative but indirect; benign explanations exist (administrative pressure to publish before fiscal close).',
      fpTraps:
        '- **End-of-fiscal-year administrative burst.**\n- **Event-driven publication** (post-disaster procurement legitimately published quickly regardless of calendar).',
      wiring:
        '✅ Production-ready. Uses raw `published_at` only. Cameroonian holidays are pinned in the pattern source.',
    },
  };
}

main();
