import { describe, expect, it } from 'vitest';

import {
  matchOutcome,
  matchSignalAgainstDossiers,
  type DeliveredDossierSummary,
  type OperationalSignal,
} from '../src/outcome-matching.js';

const sampleDossier = (
  overrides: Partial<DeliveredDossierSummary> = {},
): DeliveredDossierSummary => ({
  dossier_ref: 'VA-2026-0142',
  recipient_body: 'CONAC',
  delivered_at: '2026-01-15T10:00:00Z',
  primary_entity_id: 'ent-001',
  primary_entity_name: 'Construction Plus SARL',
  primary_entity_aliases: ['Construction Plus'],
  rccm: 'RC/YAO/2024/B/0142',
  niu: 'M042200012345R',
  ubo_names: ['Jean Mballa'],
  pattern_categories: ['A', 'B'],
  ...overrides,
});

const sampleSignal = (overrides: Partial<OperationalSignal> = {}): OperationalSignal => ({
  signal_id: 'sig-001',
  source: 'conac_press',
  kind: 'investigation_opened',
  date: '2026-04-20T10:00:00Z', // 95 days after delivery
  text: 'CONAC ouvre une enquête sur Construction Plus SARL pour irrégularités dans un marché de soumissionnaire unique.',
  entities_mentioned: ['Construction Plus SARL'],
  ...overrides,
});

describe('matchOutcome (Layer-7 closure)', () => {
  it('exact entity match + body alignment + reasonable timing → high confidence', () => {
    const m = matchOutcome(sampleDossier(), sampleSignal());
    expect(m.is_high_confidence).toBe(true);
    expect(m.dimensions.entity_overlap).toBeGreaterThan(0.6);
    expect(m.dimensions.body_alignment).toBe(1);
  });

  it('RCCM in signal text gives perfect entity overlap', () => {
    const m = matchOutcome(
      sampleDossier(),
      sampleSignal({ text: 'CONAC dossier vs entité RC/YAO/2024/B/0142', entities_mentioned: [] }),
    );
    expect(m.dimensions.entity_overlap).toBe(1);
  });

  it('signal too early (< 7 days after delivery) → temporal_proximity = 0', () => {
    const m = matchOutcome(
      sampleDossier(),
      sampleSignal({ date: '2026-01-16T10:00:00Z' }), // 1 day after delivery
    );
    expect(m.dimensions.temporal_proximity).toBe(0);
    expect(m.is_high_confidence).toBe(false);
  });

  it('signal too late (> 36 months) → temporal_proximity = 0', () => {
    const m = matchOutcome(sampleDossier(), sampleSignal({ date: '2030-01-15T10:00:00Z' }));
    expect(m.dimensions.temporal_proximity).toBe(0);
  });

  it('low entity overlap caps confidence even with strong other dimensions', () => {
    const m = matchOutcome(
      sampleDossier(),
      sampleSignal({
        entities_mentioned: ['Completely Different Entity SA'],
        text: 'CONAC procurement investigation against Completely Different Entity SA',
      }),
    );
    expect(m.is_high_confidence).toBe(false);
  });

  it('matches ARMP debarment listings against CONAC dossiers (body alignment)', () => {
    const m = matchOutcome(
      sampleDossier(),
      sampleSignal({
        source: 'armp_debarment',
        kind: 'debarment',
        text: 'ARMP debarred Construction Plus SARL for procurement fraud.',
      }),
    );
    expect(m.dimensions.body_alignment).toBe(1);
    expect(m.is_high_confidence).toBe(true);
  });

  it('matches court rulings (cour_supreme) against multiple body types', () => {
    const m = matchOutcome(
      sampleDossier({ recipient_body: 'ANIF' }),
      sampleSignal({
        source: 'cour_supreme',
        kind: 'conviction',
        text: 'Cour Suprême a condamné Construction Plus SARL pour blanchiment.',
      }),
    );
    expect(m.dimensions.body_alignment).toBe(1);
  });

  it('matches UBO name when the entity name differs but UBO is mentioned', () => {
    const m = matchOutcome(
      sampleDossier(),
      sampleSignal({
        text: "Jean Mballa, dirigeant d'une société de construction, sous enquête.",
        entities_mentioned: ['Jean Mballa'],
      }),
    );
    expect(m.dimensions.entity_overlap).toBeGreaterThan(0.5);
  });

  it('category-alignment boost: pattern A keywords found in signal text', () => {
    const m = matchOutcome(
      sampleDossier({ pattern_categories: ['A'] }),
      sampleSignal({
        text: 'irrégularités dans un marché de soumissionnaire unique',
        entities_mentioned: ['Construction Plus SARL'],
      }),
    );
    expect(m.dimensions.category_alignment).toBe(1);
  });

  it('legal-form tokens (SARL, SA) ignored in tokenisation', () => {
    const m = matchOutcome(
      sampleDossier({ primary_entity_name: 'ACME SA' }),
      sampleSignal({ entities_mentioned: ['ACME SARL'] }),
    );
    // After stopword removal both tokenise to ['acme'] → jaccard = 1.0
    expect(m.dimensions.entity_overlap).toBe(1);
  });
});

describe('matchSignalAgainstDossiers (batch matching)', () => {
  it('returns top-scoring dossiers above the candidate threshold', () => {
    const dossiers = [
      sampleDossier({ dossier_ref: 'VA-2026-0001', primary_entity_name: 'Construction Plus SARL' }),
      sampleDossier({ dossier_ref: 'VA-2026-0002', primary_entity_name: 'Different Company SA' }),
      sampleDossier({
        dossier_ref: 'VA-2026-0003',
        primary_entity_name: 'Construction Plus Holdings',
      }),
    ];
    const sig = sampleSignal();
    const matches = matchSignalAgainstDossiers(sig, dossiers);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.dossier_ref).toBe('VA-2026-0001');
    expect(matches.every((m, i, arr) => i === 0 || m.score <= arr[i - 1]!.score)).toBe(true);
  });

  it('returns empty array when no dossiers cross threshold', () => {
    const dossiers = [
      {
        ...sampleDossier(),
        primary_entity_name: 'Completely Unrelated Inc',
        primary_entity_aliases: [],
        ubo_names: [],
        rccm: undefined,
        niu: undefined,
        // Use a category whose keyword hints don't match the default signal text
        pattern_categories: ['E'],
      } as DeliveredDossierSummary,
    ];
    // Signal that has no entity overlap, no RCCM/NIU mention, and whose text
    // does not contain category-E keywords ('sanction', 'pep', 'sanctioned').
    const sig = sampleSignal({
      text: 'Affaire suivie par les autorités administratives.',
      entities_mentioned: ['Some Other Group'],
    });
    const matches = matchSignalAgainstDossiers(sig, dossiers);
    expect(matches).toHaveLength(0);
  });
});
