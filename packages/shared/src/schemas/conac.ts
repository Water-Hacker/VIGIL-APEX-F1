import { z } from 'zod';

import { zIsoInstant, zSha256Hex } from './common.js';

/* =============================================================================
 * CONAC SFTP delivery — manifest + ACK. SRD §25.
 *
 * Per W-25, the manifest schema is plug-in via a `format_adapter_version`
 * — current default is `v1`; if CONAC requires a different shape after the
 * engagement letter response, only the new format adapter changes; the
 * `worker-conac-sftp` is unchanged.
 * ===========================================================================*/

export const zConacManifestV1 = z.object({
  format_adapter_version: z.literal('v1'),
  dossier_number: z.string().regex(/^VA-\d{4}-\d{4,6}$/),
  generated_at: zIsoInstant,
  files: z.array(
    z.object({
      filename: z.string().min(3).max(200),
      sha256: zSha256Hex,
      bytes: z.number().int().positive(),
      kind: z.enum(['fr_pdf', 'en_pdf', 'evidence_archive', 'manifest']),
    }),
  ),
  finding_summary: z.object({
    title_fr: z.string().min(3).max(300),
    title_en: z.string().min(3).max(300),
    posterior: z.number().min(0).max(1),
    council_yes_votes: z.number().int().min(0).max(5),
    council_no_votes: z.number().int().min(0).max(5),
    primary_entity_label: z.string().min(1).max(300),
    amount_xaf: z.number().int().nullable(),
    region: z.string().nullable(),
  }),
  signer: z.object({
    name: z.string().min(1).max(200),
    pgp_fingerprint: z.string().regex(/^[A-F0-9]{40}$/),
    signed_at: zIsoInstant,
  }),
  audit_anchor: z.object({
    audit_event_id: z.string().min(8).max(80),
    polygon_tx_hash: z.string().regex(/^0x[a-f0-9]{64}$/i).nullable(),
  }),
});
export type ConacManifestV1 = z.infer<typeof zConacManifestV1>;

/** ACK schema — what we expect CONAC to write back to /ack/vigil-apex/. */
export const zConacAck = z.object({
  dossier_number: z.string().regex(/^VA-\d{4}-\d{4,6}$/),
  received_at: zIsoInstant,
  conac_case_reference: z.string().min(1).max(120),
  routed_to_commission: z.string().min(1).max(120).nullable(),
  notes: z.string().max(1_000).optional(),
});
export type ConacAck = z.infer<typeof zConacAck>;
