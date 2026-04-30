import { createHash } from 'node:crypto';

import { createLogger, type Logger } from '@vigil/observability';
import { Routing } from '@vigil/shared';
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx';

import { generateQrPng } from './qr.js';

import type { DossierInput, DossierRenderResult } from './types.js';

// AUDIT-055: SDK-level emits so dossier-pipeline failures don't rely
// on the worker to log them.
const defaultLogger = (): Logger => createLogger({ service: 'dossier-render' });

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
  const t = input.language === 'fr' ? FR : EN;

  let qrPng: Buffer;
  try {
    qrPng = await generateQrPng(input.publicLedgerCheckpointUrl);
  } catch (err) {
    logger.error(
      { err, ref: input.ref, url: input.publicLedgerCheckpointUrl },
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
