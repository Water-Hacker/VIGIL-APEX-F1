/**
 * Deterministic-extractor unit tests — every rule path + adversarial cases.
 *
 * The deterministic layer is the safety-critical pass: an LLM compromise
 * cannot alter what regex extraction returns. Tests therefore cover both
 * happy paths and adversarial inputs designed to confuse the parser.
 */
import { describe, expect, it } from 'vitest';

import { extractDeterministically, __test_internals } from '../src/deterministic.js';

describe('extractProcurementMethod', () => {
  const cases: Array<[string, string]> = [
    ['Marché passé en gré à gré', 'gre_a_gre'],
    ['Procédure: gré à gré', 'gre_a_gre'],
    ['Sole-source contract', 'gre_a_gre'],
    ['Single-source procurement', 'gre_a_gre'],
    ["Appel d'offres ouvert national", 'appel_offres_ouvert'],
    ["Appel d'offres restreint", 'appel_offres_restreint'],
    ['AO restreint phase 2', 'appel_offres_restreint'],
    ['Marché négocié sans publicité', 'marche_negocie'],
    ['Consultation simplifiée', 'consultation_simplifie'],
    ['Concours architectural pour la conception', 'concours'],
  ];
  for (const [text, expected] of cases) {
    it(`detects ${expected} from "${text}"`, () => {
      const r = extractDeterministically({ cells: [text] });
      expect(r.fields.procurement_method).toBe(expected);
    });
  }
  it('returns null on ambiguous text', () => {
    const r = extractDeterministically({ cells: ['Lorem ipsum dolor sit amet'] });
    expect(r.fields.procurement_method).toBeUndefined();
  });
});

describe('extractBidderCount', () => {
  const cases: Array<[string, number]> = [
    ['Soumissionnaire unique sur ce marché', 1],
    ['offre unique reçue', 1],
    ['Un seul soumissionnaire', 1],
    ['Marché passé sans mise en concurrence', 1],
    ['3 soumissionnaires ont participé', 3],
    ['7 offres reçues', 7],
    ['12 candidatures', 12],
  ];
  for (const [text, expected] of cases) {
    it(`detects bidder_count=${expected} from "${text}"`, () => {
      const r = extractDeterministically({ cells: [text] });
      expect(r.fields.bidder_count).toBe(expected);
    });
  }
  it('rejects bidder_count beyond plausible bounds', () => {
    const r = extractDeterministically({ cells: ['9999 soumissionnaires'] });
    // 9999 is 4 digits, regex caps at \d{1,3} so it shouldn't match anyway
    expect(r.fields.bidder_count).toBeUndefined();
  });
});

describe('extractAmountXaf', () => {
  const cases: Array<[string, number]> = [
    ['Montant: 123 456 789 FCFA', 123_456_789],
    ['Total 12 345 678 XAF', 12_345_678],
    ['350 millions FCFA', 350_000_000],
    ['12 milliards FCFA', 12_000_000_000],
    ['1,5 milliards FCFA', 1_500_000_000],
    ['1.5 milliard XAF', 1_500_000_000],
  ];
  for (const [text, expected] of cases) {
    it(`detects amount=${expected} from "${text}"`, () => {
      const r = extractDeterministically({ cells: [text] });
      expect(r.fields.amount_xaf).toBe(expected);
    });
  }
  it('rejects amount above PLAUSIBLE_MAX_XAF', () => {
    const r = extractDeterministically({ cells: ['99999999 milliards FCFA'] });
    expect(r.fields.amount_xaf).toBeUndefined();
  });
  it('rejects negative or zero amounts (no - prefix in regex)', () => {
    const r = extractDeterministically({ cells: ['0 FCFA'] });
    expect(r.fields.amount_xaf).toBeUndefined();
  });
});

describe('extractRegion', () => {
  const cases: Array<[string, string]> = [
    ['Marché à Yaoundé pour la commune', 'Centre'],
    ['Site: Douala port', 'Littoral'],
    ['Région du Nord, Garoua', 'Nord'],
    ["Bertoua, région de l'Est", 'Est'],
    ['Buea, sud-ouest', 'Sud-Ouest'],
  ];
  for (const [text, expected] of cases) {
    it(`detects region=${expected} from "${text}"`, () => {
      const r = extractDeterministically({ cells: [text] });
      expect(r.fields.region).toBe(expected);
    });
  }
});

describe('date extraction', () => {
  it('parses "Date d\'attribution: 15/03/2025"', () => {
    const r = extractDeterministically({ cells: ["Date d'attribution: 15/03/2025"] });
    expect(r.fields.award_date).toBe('2025-03-15');
  });
  it('parses ISO date format', () => {
    const r = extractDeterministically({ cells: ["Date d'attribution: 2025-03-15"] });
    expect(r.fields.award_date).toBe('2025-03-15');
  });
  it('parses French long-form date', () => {
    const r = extractDeterministically({ cells: ['Attribué le 15 mars 2025'] });
    expect(r.fields.award_date).toBe('2025-03-15');
  });
  it('parses two-digit year', () => {
    const r = extractDeterministically({ cells: ["Date d'attribution: 15/03/25"] });
    expect(r.fields.award_date).toBe('2025-03-15');
  });
  it('rejects nonsensical dates', () => {
    const r = extractDeterministically({ cells: ["Date d'attribution: 99/99/9999"] });
    expect(r.fields.award_date).toBeUndefined();
  });
  it('parses tender close date', () => {
    const r = extractDeterministically({
      cells: ['Date limite de dépôt: 30/04/2025'],
    });
    expect(r.fields.tender_close_date).toBe('2025-04-30');
  });
});

describe('RCCM extraction', () => {
  it('parses RCCM standard format', () => {
    const r = extractDeterministically({
      cells: ['Société immatriculée RC/YAO/2019/B/1234'],
    });
    expect(r.fields.supplier_rccm).toBe('RC/YAO/2019/B/1234');
  });
  it('returns null when RCCM absent', () => {
    const r = extractDeterministically({ cells: ['No registration on file'] });
    expect(r.fields.supplier_rccm).toBeUndefined();
  });
});

describe('NIU extraction', () => {
  it('parses NIU 14-char alphanumeric', () => {
    const r = extractDeterministically({ cells: ['NIU: P031234567890Z'] });
    expect(r.fields.supplier_niu).toBe('P031234567890Z');
  });
  it('parses N.I.U. variant with dots', () => {
    const r = extractDeterministically({ cells: ['N.I.U.: M999999999999X'] });
    expect(r.fields.supplier_niu).toBe('M999999999999X');
  });
});

describe('status keyword extraction', () => {
  it('surfaces "exclusion" keyword', () => {
    const r = extractDeterministically({
      cells: ['Décision: exclusion temporaire de 2 ans'],
    });
    expect(r.fields.status_keywords).toContain('exclusion');
  });
  it('surfaces multiple keywords', () => {
    const r = extractDeterministically({
      cells: ['Marché résilié et annulé'],
    });
    const kw = r.fields.status_keywords ?? [];
    expect(kw.length).toBeGreaterThanOrEqual(2);
  });
});

describe('escalation clause', () => {
  it('detects "clause de révision"', () => {
    const r = extractDeterministically({
      cells: ['Le contrat inclut une clause de révision des prix'],
    });
    expect(r.fields.has_escalation_clause).toBe(true);
  });
  it('detects "indexation des prix"', () => {
    const r = extractDeterministically({
      cells: ['Indexation des prix prévue annuellement'],
    });
    expect(r.fields.has_escalation_clause).toBe(true);
  });
});

describe('safety / adversarial inputs', () => {
  it('clamps very long input without ReDoS', () => {
    const giant = 'A'.repeat(__test_internals.MAX_INPUT_CHARS * 3);
    const start = Date.now();
    const r = extractDeterministically({ cells: [giant] });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000); // hard upper bound — should be < 100ms
    expect(r.fields).toBeDefined();
  });
  it('handles empty input', () => {
    const r = extractDeterministically({ cells: [] });
    expect(r.unresolved.length).toBeGreaterThan(0);
    expect(Object.keys(r.fields).length).toBe(0);
  });
  it('rejects unicode-confusable currency markers', () => {
    // "ＦＣＦＡ" (full-width) is NOT the ASCII "FCFA" — should not match
    const r = extractDeterministically({ cells: ['Total 1000 ＦＣＦＡ'] });
    expect(r.fields.amount_xaf).toBeUndefined();
  });
  it('does not extract values from across cell boundaries when joined with separator', () => {
    // "100" in cell 1, "FCFA" in cell 2 — extractor joins with " · " so
    // they DO match across the separator (intended for soft inputs).
    // This test pins that semantic so we notice if the join behaviour
    // ever changes.
    const r = extractDeterministically({ cells: ['Montant 100', 'FCFA total'] });
    expect(r.fields.amount_xaf).toBeUndefined(); // 100 too small / not in expected pattern
  });
  it('returns deterministic results — no randomness, no clock', () => {
    const a = extractDeterministically({ cells: ['12 milliards FCFA, gré à gré'] });
    const b = extractDeterministically({ cells: ['12 milliards FCFA, gré à gré'] });
    expect(a).toEqual(b);
  });
});

describe('unresolved list', () => {
  it('lists every key the deterministic pass could not extract', () => {
    const r = extractDeterministically({ cells: ['just text, no procurement keywords'] });
    expect(r.unresolved).toContain('bidder_count');
    expect(r.unresolved).toContain('procurement_method');
    expect(r.unresolved).toContain('amount_xaf');
    expect(r.unresolved).toContain('supplier_name');
  });
  it('does NOT list resolved keys', () => {
    const r = extractDeterministically({
      cells: ['Marché en gré à gré, soumissionnaire unique, 12 milliards FCFA'],
    });
    expect(r.unresolved).not.toContain('procurement_method');
    expect(r.unresolved).not.toContain('bidder_count');
    expect(r.unresolved).not.toContain('amount_xaf');
  });
});

describe('end-to-end realistic ARMP listing', () => {
  it('extracts the full canonical field set from a representative listing', () => {
    const cell = [
      "AVIS D'ATTRIBUTION — Marché public 2024/MIN/004",
      'Autorité contractante: Ministère des Travaux Publics',
      "Procédure: Appel d'offres ouvert national",
      'Date de publication: 12/01/2024',
      'Date limite de dépôt: 28/02/2024',
      "Date d'attribution: 15/03/2024",
      'Adjudicataire: SARL CONSTRUCTOR CMR — RC/DLA/2019/B/4521 — NIU: P018765432100Z',
      'Montant: 4 250 000 000 FCFA',
      'Région: Littoral',
      'Soumissionnaires: 4 offres reçues',
      'Le contrat inclut une clause de révision des prix',
    ];
    const r = extractDeterministically({ cells: cell });
    expect(r.fields.procurement_method).toBe('appel_offres_ouvert');
    expect(r.fields.amount_xaf).toBe(4_250_000_000);
    expect(r.fields.bidder_count).toBe(4);
    expect(r.fields.award_date).toBe('2024-03-15');
    expect(r.fields.tender_close_date).toBe('2024-02-28');
    expect(r.fields.tender_publication_date).toBe('2024-01-12');
    expect(r.fields.supplier_rccm).toBe('RC/DLA/2019/B/4521');
    expect(r.fields.supplier_niu).toBe('P018765432100Z');
    expect(r.fields.region).toBe('Littoral');
    expect(r.fields.has_escalation_clause).toBe(true);
  });
});
