import { z } from 'zod';

import { zIpfsCid, zIsoInstant, zSha256Hex, zUuid } from './common.js';

/* =============================================================================
 * Dossier — the bilingual PDF and its metadata. SRD §24.
 *
 * A dossier is generated when the council escalates a finding. The PDF is
 * deterministic (byte-identical for identical input — SRD §24.10 reproducibility
 * test) and signed with the architect's OpenPGP key (HSK §4.5).
 * ===========================================================================*/

export const zDossierLanguage = z.enum(['fr', 'en']);
export type DossierLanguage = z.infer<typeof zDossierLanguage>;

export const zDossierStatus = z.enum([
  'rendered',         // PDF built but not yet signed
  'signed',           // GPG signature appended
  'pinned',           // IPFS pinned
  'delivered',        // SFTP'd to CONAC (or Plan-B)
  'acknowledged',     // ACK file received
  'failed',           // delivery failed; in retry
]);
export type DossierStatus = z.infer<typeof zDossierStatus>;

export const zDossier = z.object({
  id: zUuid,
  ref: z.string().regex(/^VA-\d{4}-\d{4,6}$/),
  finding_id: zUuid,
  language: zDossierLanguage,
  status: zDossierStatus,
  pdf_sha256: zSha256Hex,
  pdf_cid: zIpfsCid.nullable(),
  signature_fingerprint: z.string().nullable(), // architect's OpenPGP fingerprint
  signature_at: zIsoInstant.nullable(),
  rendered_at: zIsoInstant,
  delivered_at: zIsoInstant.nullable(),
  acknowledged_at: zIsoInstant.nullable(),
  recipient_case_reference: z.string().nullable(), // CONAC's reference number
  manifest_hash: zSha256Hex.nullable(),
  metadata: z.record(z.unknown()).default({}),
});
export type Dossier = z.infer<typeof zDossier>;

/* =============================================================================
 * Referral — outbound delivery record. SRD §25.
 * ===========================================================================*/

export const zReferralChannel = z.enum(['conac_sftp', 'cour_des_comptes_sftp', 'minfi_api', 'manual']);
export type ReferralChannel = z.infer<typeof zReferralChannel>;

export const zReferralStatus = z.enum([
  'pending',
  'in_flight',
  'delivered',
  'acknowledged',
  'failed_retryable',
  'failed_permanent',
]);
export type ReferralStatus = z.infer<typeof zReferralStatus>;

export const zReferral = z.object({
  id: zUuid,
  dossier_id: zUuid,
  channel: zReferralChannel,
  status: zReferralStatus,
  attempts: z.number().int().nonnegative(),
  last_attempt_at: zIsoInstant.nullable(),
  ack_received_at: zIsoInstant.nullable(),
  ack_payload: z.record(z.unknown()).nullable(),
  format_adapter_version: z.string().min(1).max(20), // W-25 layer
});
export type Referral = z.infer<typeof zReferral>;
