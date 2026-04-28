import { z } from 'zod';

import { zCorrelationId, zIsoInstant, zXafAmount } from './common.js';

/* =============================================================================
 * MINFI scoring API — pre-disbursement risk score. SRD §26.
 *
 * Request: { request_id, contract_ref, amount_xaf, recipient, payment_date }
 * Response: { score, band, finding_ids, explanation_fr/en, valid_until }
 *
 * Idempotent on `request_id`. Cached 24 h.
 * ===========================================================================*/

export const zMinfiScoreBand = z.enum(['green', 'amber', 'orange', 'red']);
export type MinfiScoreBand = z.infer<typeof zMinfiScoreBand>;

export const zMinfiRecipient = z.object({
  display_name: z.string().min(1).max(300),
  rccm: z.string().min(3).max(40).nullable(),
  niu: z.string().min(3).max(40).nullable(),
  bank_account_iban: z.string().min(15).max(34).nullable(),
});
export type MinfiRecipient = z.infer<typeof zMinfiRecipient>;

export const zMinfiScoreRequest = z.object({
  request_id: zCorrelationId,
  contract_reference: z.string().min(1).max(120),
  amount_xaf: zXafAmount,
  payment_date: zIsoInstant,
  recipient: zMinfiRecipient,
  /** Optional context (procurement method, contracting authority, etc). */
  context: z
    .object({
      contracting_authority: z.string().max(200).optional(),
      procurement_method: z.string().max(80).optional(),
      project_id: z.string().max(120).optional(),
    })
    .partial()
    .optional(),
});
export type MinfiScoreRequest = z.infer<typeof zMinfiScoreRequest>;

export const zMinfiScoreResponse = z.object({
  request_id: zCorrelationId,
  score: z.number().min(0).max(1),
  band: zMinfiScoreBand,
  finding_ids: z.array(z.string()).max(50),
  /** SRD §26.10: bilingual always populated. */
  title_fr: z.string().min(3).max(300),
  title_en: z.string().min(3).max(300),
  explanation_fr: z.string().min(10).max(2_000),
  explanation_en: z.string().min(10).max(2_000),
  caveats_fr: z.string().max(1_000),
  caveats_en: z.string().max(1_000),
  computed_at: zIsoInstant,
  valid_until: zIsoInstant,
  /** ECDSA signature over the canonical response by VIGIL APEX's private key. */
  signature: z.string().min(40).max(200),
});
export type MinfiScoreResponse = z.infer<typeof zMinfiScoreResponse>;
