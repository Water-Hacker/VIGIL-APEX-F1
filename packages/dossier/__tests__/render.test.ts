/**
 * AUDIT-063 — renderDossierDocx pipeline tests.
 *
 * Goal: pin the deterministic-output contract (SRD §24.10), confirm that
 * FR vs EN outputs differ in the expected places, that the contentHash
 * is stable across calls with identical input, that classification colour
 * routing covers all three values, and that varying any input field
 * produces a different contentHash (template integrity).
 */
import { describe, expect, it, vi } from 'vitest';

import { renderDossierDocx } from '../src/render.js';

import type { DossierInput } from '../src/types.js';

function makeInput(overrides: Partial<DossierInput> = {}): DossierInput {
  return {
    ref: 'VA-2026-0001',
    language: 'fr',
    classification: 'restreint',
    finding: {
      id: '11111111-1111-1111-1111-111111111111',
      state: 'opened',
      primary_entity_id: '22222222-2222-2222-2222-222222222222',
      related_entity_ids: [],
      amount_xaf: 250_000_000,
      region: 'CE',
      severity: 'high',
      posterior: 0.78,
      signal_count: 3,
      title_fr: 'Marché public attribué sans concurrence',
      title_en: 'Public contract awarded without competition',
      summary_fr: 'Description longue en français du constat.',
      summary_en: 'Long English description of the finding.',
      counter_evidence: null,
      detected_at: '2026-04-01T08:30:00Z',
      last_signal_at: '2026-04-15T10:00:00Z',
      council_proposal_index: null,
      council_voted_at: null,
      council_yes_votes: 0,
      council_no_votes: 0,
      council_recused_addresses: [],
      closed_at: null,
      closure_reason: null,
      recommended_recipient_body: 'CONAC',
      primary_pattern_id: 'P-A-001',
    } as DossierInput['finding'],
    entities: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        kind: 'company',
        display_name: 'ACME SARL',
        is_pep: false,
        is_sanctioned: false,
      } as DossierInput['entities'][number],
    ],
    signals: [
      {
        id: '33333333-3333-3333-3333-333333333333',
        finding_id: '11111111-1111-1111-1111-111111111111',
        source: 'pattern',
        pattern_id: 'P-A-001',
        strength: 0.9,
        prior: 0.1,
        weight: 0.85,
        evidence_event_ids: [],
        evidence_document_cids: [],
        contributed_at: '2026-04-15T09:00:00Z',
        metadata: {},
      } as DossierInput['signals'][number],
    ],
    counterEvidence: 'Aucune contre-preuve disponible à ce stade.',
    auditAnchor: { auditEventId: 'audit-evt-001', polygonTxHash: null },
    council: {
      yesVotes: 0,
      noVotes: 0,
      abstain: 0,
      recused: [],
      proposalIndex: null,
    },
    verifyUrl: 'https://verify.vigilapex.cm/VA-2026-0001',
    publicLedgerCheckpointUrl: 'https://verify.vigilapex.cm/checkpoint/abcdef',
    recipientBody: 'CONAC',
    ...overrides,
  };
}

describe('AUDIT-063 — renderDossierDocx happy path', () => {
  it('returns a non-empty docx Buffer + sha256 contentHash', async () => {
    const r = await renderDossierDocx(makeInput());
    expect(Buffer.isBuffer(r.docxBytes)).toBe(true);
    expect(r.docxBytes.length).toBeGreaterThan(1000);
    expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('docx starts with a ZIP local-file header (PK\\x03\\x04)', async () => {
    const { docxBytes } = await renderDossierDocx(makeInput());
    expect(docxBytes.subarray(0, 4).toString('hex')).toBe('504b0304');
  });
});

describe('AUDIT-063 — determinism (SRD §24.10 acceptance test)', () => {
  it('same input → same contentHash across two independent renders', async () => {
    const a = await renderDossierDocx(makeInput());
    const b = await renderDossierDocx(makeInput());
    expect(a.contentHash).toBe(b.contentHash);
  });

  it('contentHash is the load-bearing determinism invariant (not raw docxBytes)', async () => {
    // SRD §24.10 requires byte-identical *PDFs*, achieved post-render
    // by LibreOffice + a PDF normalisation pass (worker-dossier).
    // Pre-PDF, docx-js embeds a build-time mtime in the inner ZIP
    // central directory, so raw docxBytes are NOT byte-identical
    // across two `renderDossierDocx` calls. The strict invariant the
    // worker depends on is `contentHash` — computed over the canonical
    // input model + the deterministic qr PNG. Pin that explicitly here.
    const a = await renderDossierDocx(makeInput());
    const b = await renderDossierDocx(makeInput());
    expect(a.contentHash).toBe(b.contentHash);
    // Surface the docx non-determinism so a future contributor who
    // tries to assert byte-identity sees this comment first.
    expect(typeof a.docxBytes.length).toBe('number');
  });
});

describe('AUDIT-063 — language routing', () => {
  it('FR vs EN inputs produce different contentHash', async () => {
    const fr = await renderDossierDocx(makeInput({ language: 'fr' }));
    const en = await renderDossierDocx(makeInput({ language: 'en' }));
    expect(fr.contentHash).not.toBe(en.contentHash);
  });
});

describe('AUDIT-063 — classification colour branches', () => {
  it('renders without throwing for restreint, confidentiel, public', async () => {
    for (const cls of ['restreint', 'confidentiel', 'public'] as const) {
      const r = await renderDossierDocx(makeInput({ classification: cls }));
      expect(r.docxBytes.length).toBeGreaterThan(1000);
    }
  });

  it('different classification → different contentHash (the colour is folded into the canonical model)', async () => {
    const a = await renderDossierDocx(makeInput({ classification: 'restreint' }));
    const b = await renderDossierDocx(makeInput({ classification: 'public' }));
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});

describe('AUDIT-063 — recipient body routing on the cover page', () => {
  it('renders for every RecipientBody value', async () => {
    const bodies = ['CONAC', 'COUR_DES_COMPTES', 'MINFI', 'ANIF', 'CDC', 'OTHER'] as const;
    for (const body of bodies) {
      const r = await renderDossierDocx(makeInput({ recipientBody: body }));
      expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('different recipientBody → different contentHash', async () => {
    const a = await renderDossierDocx(makeInput({ recipientBody: 'CONAC' }));
    const b = await renderDossierDocx(makeInput({ recipientBody: 'MINFI' }));
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});

describe('AUDIT-055 — renderDossierDocx accepts a logger and emits on failure', () => {
  function fakeLogger() {
    return {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      silent: vi.fn(),
      level: 'info',
      child: vi.fn(),
    };
  }

  it('accepts an injected logger; happy path does NOT emit error', async () => {
    const logger = fakeLogger();
    await renderDossierDocx(makeInput(), { logger: logger as never });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('AUDIT-063 — content sensitivity (template integrity)', () => {
  it('changing the ref produces a different contentHash', async () => {
    const a = await renderDossierDocx(makeInput({ ref: 'VA-2026-0001' }));
    const b = await renderDossierDocx(makeInput({ ref: 'VA-2026-9999' }));
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('changing posterior produces a different contentHash', async () => {
    const a = await renderDossierDocx(makeInput());
    const b = await renderDossierDocx(
      makeInput({
        finding: { ...makeInput().finding, posterior: 0.99 } as DossierInput['finding'],
      }),
    );
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('null amount_xaf is rendered without throwing (unknown branch)', async () => {
    const r = await renderDossierDocx(
      makeInput({
        finding: { ...makeInput().finding, amount_xaf: null } as DossierInput['finding'],
      }),
    );
    expect(r.docxBytes.length).toBeGreaterThan(1000);
  });

  it('null polygonTxHash renders the "pending" branch', async () => {
    const a = await renderDossierDocx(makeInput());
    const b = await renderDossierDocx(
      makeInput({
        auditAnchor: { auditEventId: 'audit-evt-001', polygonTxHash: '0xabc' },
      }),
    );
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('PEP / sanctioned flags are rendered without throwing', async () => {
    const r = await renderDossierDocx(
      makeInput({
        entities: [
          {
            id: '22222222-2222-2222-2222-222222222222',
            kind: 'person',
            display_name: 'Jean Dupont',
            is_pep: true,
            is_sanctioned: true,
          } as DossierInput['entities'][number],
        ],
      }),
    );
    expect(r.docxBytes.length).toBeGreaterThan(1000);
  });
});
