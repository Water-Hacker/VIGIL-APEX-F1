import { z } from 'zod';

import { zIpfsCid, zIsoInstant, zSha256Hex, zSourceId, zUuid } from './common.js';

/* =============================================================================
 * Document — fetched binary artefact (PDF, image, scanned form, HTML snapshot)
 *
 * Pipeline (SRD §14):
 *   fetch → SHA-256 → MIME → language → OCR (Tesseract / Textract) → IPFS pin → DB
 * ===========================================================================*/

export const zDocumentMime = z.enum([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
  'text/html',
  'text/plain',
  'application/zip',
  'application/octet-stream',
  'application/json',
  'application/xml',
]);
export type DocumentMime = z.infer<typeof zDocumentMime>;

export const zDocumentLanguage = z.enum(['fr', 'en', 'fr-CM', 'en-CM', 'mixed', 'unknown']);
export type DocumentLanguage = z.infer<typeof zDocumentLanguage>;

export const zDocumentKind = z.enum([
  'tender',
  'award',
  'amendment',
  'budget',
  'audit_report',
  'court_judgement',
  'gazette',
  'press_release',
  'company_filing',
  'sanction_list',
  'satellite_imagery',
  'robots',
  'tos',
  'other',
]);
export type DocumentKind = z.infer<typeof zDocumentKind>;

export const zDocumentOcrEngine = z.enum(['tesseract', 'textract', 'pdf-text-layer', 'none']);
export type DocumentOcrEngine = z.infer<typeof zDocumentOcrEngine>;

export const zDocument = z.object({
  id: zUuid,
  cid: zIpfsCid,
  source_id: zSourceId,
  kind: zDocumentKind,
  mime: zDocumentMime,
  language: zDocumentLanguage,
  bytes: z.number().int().positive(),
  sha256: zSha256Hex,
  source_url: z.string().url().nullable(),
  fetched_at: zIsoInstant,
  ocr_engine: zDocumentOcrEngine,
  ocr_confidence: z.number().min(0).max(1).nullable(),
  text_extract_chars: z.number().int().nonnegative().nullable(),
  pinned_at_ipfs: z.boolean(),
  mirrored_to_synology: z.boolean(),
  metadata: z.record(z.unknown()).default({}),
});
export type Document = z.infer<typeof zDocument>;

/* =============================================================================
 * Extraction result — structured fields the LLM/regex pulled out of a document
 * ===========================================================================*/

export const zDocumentExtractionField = z.object({
  field: z.string().min(1).max(100),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  confidence: z.number().min(0).max(1),
  /** Citation MUST be present per SRD §20.3. */
  citation: z.object({
    document_cid: zIpfsCid,
    page: z.number().int().nonnegative().nullable(),
    char_span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable(),
  }),
});
export type DocumentExtractionField = z.infer<typeof zDocumentExtractionField>;

export const zDocumentExtractionResult = z.object({
  document_cid: zIpfsCid,
  schema_version: z.number().int().min(1),
  language: zDocumentLanguage,
  fields: z.array(zDocumentExtractionField),
  llm: z.object({
    model: z.string(),
    temperature: z.number().min(0).max(1),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cost_usd: z.number().nonnegative(),
  }),
  extracted_at: zIsoInstant,
});
export type DocumentExtractionResult = z.infer<typeof zDocumentExtractionResult>;
