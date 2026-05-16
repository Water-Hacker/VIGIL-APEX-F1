import { createHash } from 'node:crypto';

import { createLogger, type Logger } from '@vigil/observability';
import { Errors, Routing } from '@vigil/shared';
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx';

import { generateQrPng } from './qr.js';

import type { DossierInput, DossierRenderResult } from './types.js';

// AUDIT-055: SDK-level emits so dossier-pipeline failures don't rely
// on the worker to log them.
const defaultLogger = (): Logger => createLogger({ service: 'dossier-render' });

/**
 * Tier-46 audit closure — render-boundary input validation.
 *
 * Dossiers are official documents addressed to CONAC, MINFI, Cour des
 * Comptes, etc. The rendering input flows from worker-dossier, which
 * pulls from Postgres + the worker-counter-evidence output + the
 * audit-chain repo. Most fields are system-controlled but several are
 * either user-controlled (tip narrative, downstream LLM summaries) or
 * external-feed-controlled (entity display_name from ANIF/sanctions
 * lists). The render-boundary validator below catches four classes of
 * pathological input BEFORE they reach the docx generator:
 *
 *   - URL fields that aren't HTTPS. A non-HTTPS URL printed on an
 *     official document — or worse, encoded into the QR code citizens
 *     scan to verify a finding — is a fraud risk. Refuse loud.
 *
 *   - Oversized text payloads. The counter-evidence narrative or LLM-
 *     generated summary could be megabytes if a bug upstream lifted a
 *     cap. A 100 MB dossier hangs LibreOffice in the PDF conversion
 *     step. Hard caps with structured rejection.
 *
 *   - Oversized arrays. An entities feed corruption could ship 100k+
 *     entries; rendering each as a Paragraph blows up the docx file
 *     and the eventual PDF.
 *
 *   - Control chars invalid in XML 1.0. `docx` builds an XML stream;
 *     NUL / \x01-\x08 / \x0B / \x0C / \x0E-\x1F in any text field
 *     produces a docx Word/LibreOffice refuses to open. Strip-or-
 *     reject defence: REJECT, so the operator sees the upstream
 *     defect rather than a silently truncated dossier.
 */
const MAX_QR_PAYLOAD_BYTES = 2900; // QR byte-mode cap is ~2953; leave headroom
const MAX_TEXT_FIELD_CHARS = 50_000; // single text fields (summary, narrative)
const MAX_REF_CHARS = 64; // VA-YYYY-NNNN shapes max ~15 chars
const MAX_DISPLAY_NAME_CHARS = 512; // entity display names
const MAX_ENTITIES = 500;
const MAX_SIGNALS = 1_000;
const MAX_RECUSED = 50;

// XML 1.0 invalid character classes — match controls but allow the
// three whitespace chars that ARE valid (\t \n \r).
// eslint-disable-next-line no-control-regex
const XML_INVALID_CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

function assertHttpsUrl(name: string, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Errors.VigilError({
      code: 'DOSSIER_INPUT_URL_INVALID',
      message: `${name} is not a valid URL: ${value.slice(0, 200)}`,
      severity: 'error',
    });
  }
  if (url.protocol !== 'https:') {
    throw new Errors.VigilError({
      code: 'DOSSIER_INPUT_URL_INSECURE',
      message: `${name} must be https://; got ${url.protocol}//`,
      severity: 'error',
    });
  }
}

function assertNoControlChars(name: string, value: string): void {
  if (XML_INVALID_CONTROL.test(value)) {
    throw new Errors.VigilError({
      code: 'DOSSIER_INPUT_CONTROL_CHAR',
      message: `${name} contains XML-invalid control characters; reject upstream defect`,
      severity: 'error',
    });
  }
}

function assertLength(name: string, value: string, max: number): void {
  if (value.length > max) {
    throw new Errors.VigilError({
      code: 'DOSSIER_INPUT_FIELD_TOO_LARGE',
      message: `${name} length ${value.length} exceeds cap ${max}`,
      severity: 'error',
    });
  }
}

function validateText(name: string, value: string, max: number): void {
  assertLength(name, value, max);
  assertNoControlChars(name, value);
}

function validateDossierInput(input: DossierInput): void {
  // URLs first — fast and high-signal.
  assertHttpsUrl('verifyUrl', input.verifyUrl);
  assertHttpsUrl('publicLedgerCheckpointUrl', input.publicLedgerCheckpointUrl);

  // QR payload bound — must fit in QR byte mode for the renderer to
  // succeed. Throwing here is preferable to a confusing qrcode error.
  if (Buffer.byteLength(input.publicLedgerCheckpointUrl, 'utf8') > MAX_QR_PAYLOAD_BYTES) {
    throw new Errors.VigilError({
      code: 'DOSSIER_INPUT_QR_PAYLOAD_TOO_LARGE',
      message: `publicLedgerCheckpointUrl ${Buffer.byteLength(input.publicLedgerCheckpointUrl, 'utf8')}B exceeds QR cap ${MAX_QR_PAYLOAD_BYTES}B`,
      severity: 'error',
    });
  }

  // Scalar text fields.
  validateText('ref', input.ref, MAX_REF_CHARS);
  validateText('counterEvidence', input.counterEvidence, MAX_TEXT_FIELD_CHARS);
  validateText('finding.summary_fr', input.finding.summary_fr ?? '', MAX_TEXT_FIELD_CHARS);
  validateText('finding.summary_en', input.finding.summary_en ?? '', MAX_TEXT_FIELD_CHARS);
  validateText('finding.title_fr', input.finding.title_fr ?? '', MAX_DISPLAY_NAME_CHARS);
  validateText('finding.title_en', input.finding.title_en ?? '', MAX_DISPLAY_NAME_CHARS);

  // Arrays.
  if (input.entities.length > MAX_ENTITIES) {
    throw new Errors.VigilError({
      code: 'DOSSIER_INPUT_ARRAY_TOO_LARGE',
      message: `entities length ${input.entities.length} exceeds cap ${MAX_ENTITIES}`,
      severity: 'error',
    });
  }
  if (input.signals.length > MAX_SIGNALS) {
    throw new Errors.VigilError({
      code: 'DOSSIER_INPUT_ARRAY_TOO_LARGE',
      message: `signals length ${input.signals.length} exceeds cap ${MAX_SIGNALS}`,
      severity: 'error',
    });
  }
  if (input.council.recused.length > MAX_RECUSED) {
    throw new Errors.VigilError({
      code: 'DOSSIER_INPUT_ARRAY_TOO_LARGE',
      message: `council.recused length ${input.council.recused.length} exceeds cap ${MAX_RECUSED}`,
      severity: 'error',
    });
  }

  // Per-element text checks for the arrays.
  for (const e of input.entities) {
    validateText('entities[].display_name', e.display_name, MAX_DISPLAY_NAME_CHARS);
  }
  for (const s of input.signals) {
    if (s.pattern_id) validateText('signals[].pattern_id', s.pattern_id, MAX_DISPLAY_NAME_CHARS);
    validateText('signals[].source', s.source, MAX_DISPLAY_NAME_CHARS);
  }
}

/**
 * Render a dossier to .docx bytes (deterministic).
 *
 * The actual `.pdf` step is delegated to LibreOffice headless via the
 * `soffice --headless --convert-to pdf` subprocess, invoked by the caller
 * (worker-dossier) with reproducible options. Determinism guarantees:
 *   - Date strings come from the input, not Date.now()
 *   - Map iteration order is preserved by docx-js
 *   - QR code is deterministic for identical payload
 */
export async function renderDossierDocx(
  input: DossierInput,
  opts: { logger?: Logger } = {},
): Promise<DossierRenderResult> {
  const logger = opts.logger ?? defaultLogger();
  // Tier-46 render-boundary validation. Runs BEFORE any I/O so a
  // structurally-invalid input never reaches QR generation or docx
  // packing.
  validateDossierInput(input);
  const t = input.language === 'fr' ? FR : EN;

  let qrPng: Buffer;
  try {
    qrPng = await generateQrPng(input.publicLedgerCheckpointUrl);
  } catch (err) {
    // Tier-35 audit closure: structured err_name / err_message rather
    // than the raw Error object, matching the T13/T15/T16/T17/T19/T21/
    // T24/T29 convention.
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error(
      {
        err_name: e.name,
        err_message: e.message,
        ref: input.ref,
        url: input.publicLedgerCheckpointUrl,
      },
      'dossier-render-qr-failed',
    );
    throw err;
  }

  const headers = Routing.recipientBodyHeaders(input.recipientBody);
  const recipientHeader = input.language === 'fr' ? headers.fr : headers.en;

  const cover = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'RÉPUBLIQUE DU CAMEROUN — REPUBLIC OF CAMEROON',
          bold: true,
          size: 22,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Paix — Travail — Patrie', size: 18 })],
    }),
    new Paragraph({ text: '' }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'VIGIL APEX', bold: true, size: 36 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: recipientHeader.title, size: 24 })],
    }),
    new Paragraph({ text: '' }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: input.ref, bold: true, size: 28 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `${t.classification}: ${input.classification.toUpperCase()}`,
          color: classificationColour(input.classification),
          bold: true,
          size: 18,
        }),
      ],
    }),
    new Paragraph({ text: '' }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: recipientHeader.addressee, italics: true, size: 20 })],
    }),
    new Paragraph({ text: '' }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          data: qrPng,
          transformation: { width: 192, height: 192 },
          type: 'png',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: input.verifyUrl, size: 14 })],
    }),
  ];

  const summarySection = [
    new Paragraph({ text: t.summary, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      text: input.language === 'fr' ? input.finding.summary_fr : input.finding.summary_en,
    }),
  ];

  const findingSection = [
    new Paragraph({ text: t.finding_section, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new TextRun({ text: `${t.field_title}: `, bold: true }),
        new TextRun({
          text: input.language === 'fr' ? input.finding.title_fr : input.finding.title_en,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `${t.field_severity}: `, bold: true }),
        new TextRun({ text: input.finding.severity }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `${t.field_posterior}: `, bold: true }),
        new TextRun({ text: input.finding.posterior?.toFixed(2) ?? 'n/a' }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `${t.field_amount}: `, bold: true }),
        new TextRun({
          text:
            input.finding.amount_xaf !== null
              ? `${input.finding.amount_xaf.toLocaleString('fr-CM')} XAF`
              : t.unknown,
        }),
      ],
    }),
  ];

  const entitiesSection = [
    new Paragraph({ text: t.entities_section, heading: HeadingLevel.HEADING_1 }),
    ...input.entities.map(
      (e) =>
        new Paragraph({
          children: [
            new TextRun({ text: e.display_name, bold: true }),
            new TextRun({ text: ` — ${e.kind}` }),
            ...(e.is_pep ? [new TextRun({ text: '  [PEP]', color: 'CC0000' })] : []),
            ...(e.is_sanctioned ? [new TextRun({ text: '  [SANCTIONED]', color: 'CC0000' })] : []),
          ],
        }),
    ),
  ];

  const signalsSection = [
    new Paragraph({ text: t.signals_section, heading: HeadingLevel.HEADING_1 }),
    ...input.signals.map(
      (s) =>
        new Paragraph({
          children: [
            new TextRun({ text: `${s.pattern_id ?? s.source}`, bold: true }),
            new TextRun({
              text: ` — strength ${s.strength.toFixed(2)}, weight ${s.weight.toFixed(2)}`,
            }),
          ],
        }),
    ),
  ];

  const caveatsSection = [
    new Paragraph({ text: t.caveats_section, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: input.counterEvidence }),
  ];

  const councilSection = [
    new Paragraph({ text: t.council_section, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      text: `${t.proposal_index}: ${input.council.proposalIndex ?? 'n/a'} — YES ${input.council.yesVotes} / NO ${input.council.noVotes} / ABS ${input.council.abstain} / REC ${input.council.recused.length}`,
    }),
  ];

  const provenanceSection = [
    new Paragraph({ text: t.provenance_section, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new TextRun({ text: `${t.audit_event_id}: `, bold: true }),
        new TextRun({ text: input.auditAnchor.auditEventId }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `${t.polygon_anchor}: `, bold: true }),
        new TextRun({ text: input.auditAnchor.polygonTxHash ?? t.pending }),
      ],
    }),
  ];

  const doc = new Document({
    creator: 'VIGIL APEX',
    title: `${input.ref} — ${input.finding.title_en}`,
    description: 'Forensic dossier — restricted distribution',
    sections: [
      {
        properties: {},
        children: [
          ...cover,
          ...summarySection,
          ...findingSection,
          ...entitiesSection,
          ...signalsSection,
          ...caveatsSection,
          ...councilSection,
          ...provenanceSection,
        ],
      },
    ],
  });

  let docxBytes: Buffer;
  try {
    docxBytes = await Packer.toBuffer(doc);
  } catch (err) {
    logger.error({ err, ref: input.ref }, 'dossier-render-pack-failed');
    throw err;
  }
  // Hash a canonical model (input + qr) so reproducibility test works.
  // We canonicalise recursively with sorted keys at every depth — passing
  // an array of top-level keys to JSON.stringify's replacer would silently
  // filter every nested property whose name isn't a top-level key
  // (e.g., finding.posterior, auditAnchor.polygonTxHash), which made the
  // hash insensitive to most input changes (caught by AUDIT-063 tests).
  const canonical = canonicalJson(input as unknown);
  const contentHash = createHash('sha256').update(canonical).update(qrPng).digest('hex');
  return { docxBytes, contentHash };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

function classificationColour(c: 'restreint' | 'confidentiel' | 'public'): string {
  switch (c) {
    case 'public':
      return '008000';
    case 'confidentiel':
      return 'CC8800';
    case 'restreint':
      return 'CC0000';
  }
}

const FR = {
  dossier_title: 'Dossier d’analyse forensique',
  classification: 'CLASSIFICATION',
  summary: 'Résumé',
  finding_section: 'Constat',
  entities_section: 'Entités',
  signals_section: 'Signaux et motifs',
  caveats_section: 'Mises en garde / explications alternatives',
  council_section: 'Conseil',
  provenance_section: 'Provenance',
  field_title: 'Titre',
  field_severity: 'Sévérité',
  field_posterior: 'Probabilité postérieure',
  field_amount: 'Montant',
  proposal_index: 'Numéro de proposition',
  audit_event_id: 'Identifiant d’audit',
  polygon_anchor: 'Ancre Polygon',
  unknown: 'inconnu',
  pending: 'en attente',
};

const EN = {
  dossier_title: 'Forensic Analysis Dossier',
  classification: 'CLASSIFICATION',
  summary: 'Summary',
  finding_section: 'Finding',
  entities_section: 'Entities',
  signals_section: 'Signals and Patterns',
  caveats_section: 'Caveats / Alternative Explanations',
  council_section: 'Council',
  provenance_section: 'Provenance',
  field_title: 'Title',
  field_severity: 'Severity',
  field_posterior: 'Posterior probability',
  field_amount: 'Amount',
  proposal_index: 'Proposal index',
  audit_event_id: 'Audit event ID',
  polygon_anchor: 'Polygon anchor',
  unknown: 'unknown',
  pending: 'pending',
};
