import { z } from 'zod';

import { zIsoInstant, zUuid } from './common.js';

/* =============================================================================
 * Tip — anonymous citizen submission via /tip portal. SRD §28.
 *
 * Tips are client-side encrypted with libsodium sealed-box to the operator
 * team's public key. The encrypted blob is stored; decryption requires the
 * operator team's private key (Vault) and, for sensitive tips, 3-of-5
 * council quorum (the council member's YubiKey decrypts a Shamir share).
 * ===========================================================================*/

export const zTipDisposition = z.enum([
  'NEW',
  'IN_TRIAGE',
  'DISMISSED',
  'ARCHIVED',
  'PROMOTED',
]);
export type TipDisposition = z.infer<typeof zTipDisposition>;

export const zTipAttachmentKind = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'audio/ogg',
  'audio/mpeg',
]);
export type TipAttachmentKind = z.infer<typeof zTipAttachmentKind>;

export const zTipSubmission = z.object({
  /** Required — at least 50 chars to discourage spam, max 5000. */
  body_ciphertext_b64: z.string().min(120).max(20_000),
  /** Encrypted contact info — optional. */
  contact_ciphertext_b64: z.string().max(2_000).optional(),
  /** Topic hint — optional, helps triage. */
  topic_hint: z
    .enum([
      'procurement',
      'payroll',
      'infrastructure',
      'sanctions',
      'banking',
      'other',
    ])
    .optional(),
  /** Region hint — optional. */
  region: z
    .enum(['AD', 'CE', 'EN', 'ES', 'LT', 'NO', 'NW', 'OU', 'SU', 'SW', 'unknown'])
    .optional(),
  /** Up to 5 attachments, each up to 10 MB after EXIF strip. */
  attachment_cids: z.array(z.string()).max(5).default([]),
  /** Cloudflare Turnstile token — anti-bot only; never logged. */
  turnstile_token: z.string().min(20).max(2_000),
});
export type TipSubmission = z.infer<typeof zTipSubmission>;

export const zTip = z.object({
  id: zUuid,
  ref: z.string().regex(/^TIP-\d{4}-\d{4,6}$/),
  disposition: zTipDisposition,
  body_ciphertext_b64: z.string(),
  contact_ciphertext_b64: z.string().nullable(),
  attachment_cids: z.array(z.string()),
  topic_hint: z.string().nullable(),
  region: z.string().nullable(),
  received_at: zIsoInstant,
  triaged_at: zIsoInstant.nullable(),
  triaged_by: z.string().nullable(),
  promoted_finding_id: zUuid.nullable(),
  /** Encrypted notes from the triage operator. */
  triage_notes_ciphertext_b64: z.string().nullable(),
});
export type Tip = z.infer<typeof zTip>;
