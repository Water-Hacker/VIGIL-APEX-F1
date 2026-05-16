/**
 * Tier-46 audit closure — render-boundary input validation.
 *
 * Dossiers are official documents addressed to CONAC, MINFI, Cour des
 * Comptes. The render pipeline previously accepted any DossierInput
 * shape and shipped four classes of pathological input straight to
 * the docx generator + QR encoder:
 *
 *   - Non-HTTPS URL fields (verifyUrl, publicLedgerCheckpointUrl).
 *     Printed on an official document and encoded into the QR; a
 *     citizen scanning the QR would land on an http:// (or worse,
 *     custom-scheme) link. Fraud surface.
 *
 *   - Oversized text payloads. counterEvidence or LLM summary could
 *     be megabytes if an upstream cap regressed; 100MB dossier hangs
 *     LibreOffice in the PDF conversion step.
 *
 *   - Oversized arrays. An entities feed corruption shipping 100k+
 *     entries blows up docx file size and the eventual PDF.
 *
 *   - XML 1.0 invalid control characters (NUL, \x01-\x08, etc.) in
 *     text. The docx library builds an XML stream; an invalid char
 *     in any text field produces a docx Word/LibreOffice refuses to
 *     open — silent dossier loss.
 *
 * Tests below verify each rejection path. The happy-path render
 * still works (covered by existing render.test.ts, 25 tests).
 */
import { Errors } from '@vigil/shared';
import { describe, expect, it } from 'vitest';

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
      title_fr: 'titre',
      title_en: 'title',
      summary_fr: 'résumé',
      summary_en: 'summary',
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
    counterEvidence: 'OK',
    auditAnchor: { auditEventId: 'audit-evt-001', polygonTxHash: null },
    council: { yesVotes: 0, noVotes: 0, abstain: 0, recused: [], proposalIndex: null },
    verifyUrl: 'https://verify.vigilapex.cm/VA-2026-0001',
    publicLedgerCheckpointUrl: 'https://verify.vigilapex.cm/checkpoint/abcdef',
    recipientBody: 'CONAC',
    ...overrides,
  };
}

async function expectRejection(input: DossierInput, expectedCode: string): Promise<void> {
  let caught: unknown;
  try {
    await renderDossierDocx(input);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(Errors.VigilError);
  expect((caught as { code?: string }).code).toBe(expectedCode);
}

describe('Tier-46 — URL fields must be HTTPS', () => {
  it('rejects http:// verifyUrl', async () => {
    await expectRejection(
      makeInput({ verifyUrl: 'http://verify.vigilapex.cm/x' }),
      'DOSSIER_INPUT_URL_INSECURE',
    );
  });

  it('rejects file:// publicLedgerCheckpointUrl', async () => {
    await expectRejection(
      makeInput({ publicLedgerCheckpointUrl: 'file:///etc/passwd' }),
      'DOSSIER_INPUT_URL_INSECURE',
    );
  });

  it('rejects custom-scheme javascript: in verifyUrl', async () => {
    await expectRejection(
      makeInput({ verifyUrl: 'javascript:alert(1)' }),
      'DOSSIER_INPUT_URL_INSECURE',
    );
  });

  it('rejects garbage verifyUrl with DOSSIER_INPUT_URL_INVALID', async () => {
    await expectRejection(
      makeInput({ verifyUrl: 'not even close to a url' }),
      'DOSSIER_INPUT_URL_INVALID',
    );
  });

  it('accepts a clean https URL pair (sanity — happy path still works)', async () => {
    const r = await renderDossierDocx(makeInput());
    expect(r.docxBytes.length).toBeGreaterThan(1000);
  });
});

describe('Tier-46 — QR payload size cap', () => {
  it('rejects publicLedgerCheckpointUrl exceeding the QR byte-mode cap', async () => {
    const big = 'https://verify.vigilapex.cm/' + 'a'.repeat(3000);
    await expectRejection(
      makeInput({ publicLedgerCheckpointUrl: big }),
      'DOSSIER_INPUT_QR_PAYLOAD_TOO_LARGE',
    );
  });
});

describe('Tier-46 — Text-field length caps', () => {
  it('rejects counterEvidence > 50k chars', async () => {
    await expectRejection(
      makeInput({ counterEvidence: 'X'.repeat(50_001) }),
      'DOSSIER_INPUT_FIELD_TOO_LARGE',
    );
  });

  it('rejects ref > 64 chars', async () => {
    await expectRejection(
      makeInput({ ref: 'VA-2026-' + '0'.repeat(60) }),
      'DOSSIER_INPUT_FIELD_TOO_LARGE',
    );
  });

  it('rejects entity display_name > 512 chars', async () => {
    const e = {
      id: '22222222-2222-2222-2222-222222222222',
      kind: 'company',
      display_name: 'X'.repeat(513),
      is_pep: false,
      is_sanctioned: false,
    } as DossierInput['entities'][number];
    await expectRejection(makeInput({ entities: [e] }), 'DOSSIER_INPUT_FIELD_TOO_LARGE');
  });
});

describe('Tier-46 — Array size caps', () => {
  it('rejects entities array > MAX_ENTITIES (500)', async () => {
    const e = {
      id: '22222222-2222-2222-2222-222222222222',
      kind: 'company',
      display_name: 'x',
      is_pep: false,
      is_sanctioned: false,
    } as DossierInput['entities'][number];
    const entities = Array.from({ length: 501 }, () => e);
    await expectRejection(makeInput({ entities }), 'DOSSIER_INPUT_ARRAY_TOO_LARGE');
  });

  it('rejects council.recused array > MAX_RECUSED (50)', async () => {
    const recused = Array.from({ length: 51 }, (_, i) => `0xrecused${i}`);
    await expectRejection(
      makeInput({
        council: { yesVotes: 0, noVotes: 0, abstain: 0, recused, proposalIndex: null },
      }),
      'DOSSIER_INPUT_ARRAY_TOO_LARGE',
    );
  });
});

describe('Tier-46 — XML-invalid control characters', () => {
  it('rejects NUL in counterEvidence', async () => {
    await expectRejection(
      makeInput({ counterEvidence: 'before\x00after' }),
      'DOSSIER_INPUT_CONTROL_CHAR',
    );
  });

  it('rejects \\x01 in entity display_name', async () => {
    const e = {
      id: '22222222-2222-2222-2222-222222222222',
      kind: 'company',
      display_name: 'ACME\x01SARL',
      is_pep: false,
      is_sanctioned: false,
    } as DossierInput['entities'][number];
    await expectRejection(makeInput({ entities: [e] }), 'DOSSIER_INPUT_CONTROL_CHAR');
  });

  it('accepts legitimate whitespace (\\t \\n \\r) in counterEvidence', async () => {
    const r = await renderDossierDocx(
      makeInput({ counterEvidence: 'line one\nline two\tcolumn\r\ndone' }),
    );
    expect(r.docxBytes.length).toBeGreaterThan(1000);
  });
});
