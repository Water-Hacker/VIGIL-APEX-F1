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

/* =============================================================================
 * DECISION-010 — per-body manifest variants. Each body has its own envelope
 * shape; CONAC v1 is the base above; the others are documented in
 * `docs/source/COUR-DES-COMPTES-MANIFEST-v1.md` and SRD §26.4 / §28.7.
 *
 * The shapes share a common header (dossier_number, generated_at, files,
 * signer, audit_anchor) and differ in the body-specific payload below.
 * ===========================================================================*/

const zManifestFile = z.object({
  filename: z.string().min(3).max(200),
  sha256: zSha256Hex,
  bytes: z.number().int().positive(),
  kind: z.enum(['fr_pdf', 'en_pdf', 'evidence_archive', 'manifest']),
});

const zManifestSigner = z.object({
  name: z.string().min(1).max(200),
  pgp_fingerprint: z.string().regex(/^[A-F0-9]{40}$/),
  signed_at: zIsoInstant,
});

const zManifestAuditAnchor = z.object({
  audit_event_id: z.string().min(8).max(80),
  polygon_tx_hash: z.string().regex(/^0x[a-f0-9]{64}$/i).nullable(),
});

/** Cour des Comptes — référé envelope.
 *  Per circulaire-CDC-NORM-2024 (mirrored in docs/source/COUR-DES-COMPTES-MANIFEST-v1.md):
 *  field renames vs CONAC + an extra `audit_finding_class` enum + chamber routing. */
export const zCourDesComptesManifestV1 = z.object({
  format_adapter_version: z.literal('v1'),
  recipient_body_name: z.literal('COUR_DES_COMPTES'),
  reference_dossier: z.string().regex(/^VA-\d{4}-\d{4,6}$/),
  emis_le: zIsoInstant,
  fichiers: z.array(zManifestFile),
  resume_constatation: z.object({
    intitule_fr: z.string().min(3).max(300),
    intitule_en: z.string().min(3).max(300),
    probabilite_a_posteriori: z.number().min(0).max(1),
    votes_oui: z.number().int().min(0).max(5),
    votes_non: z.number().int().min(0).max(5),
    sujet_principal_libelle: z.string().min(1).max(300),
    montant_xaf: z.number().int().nullable(),
    region: z.string().nullable(),
    audit_finding_class: z.enum([
      'gestion_de_fait',
      'irregularite_d_engagement',
      'irregularite_d_execution',
      'depense_sans_service_fait',
      'autre',
    ]),
  }),
  chambre_destinataire: z.enum([
    'chambre_des_finances',
    'chambre_des_collectivites',
    'chambre_des_etablissements_publics',
  ]),
  signataire: zManifestSigner,
  ancrage_audit: zManifestAuditAnchor,
});
export type CourDesComptesManifestV1 = z.infer<typeof zCourDesComptesManifestV1>;

/** MINFI pre-disbursement risk envelope per SRD §26.4.
 *  Idempotent on `request_id`; informs (does not block) disbursement. */
export const zMinfiPreDisbursementManifestV1 = z.object({
  format_adapter_version: z.literal('v1'),
  recipient_body_name: z.literal('MINFI'),
  request_id: z.string().min(8).max(80), // matches MINFI's pre-disbursement request id
  dossier_number: z.string().regex(/^VA-\d{4}-\d{4,6}$/),
  generated_at: zIsoInstant,
  files: z.array(zManifestFile),
  risk_score: z.object({
    posterior: z.number().min(0).max(1),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    advisory: z.enum(['proceed', 'review', 'hold_pending_clarification', 'do_not_proceed']),
    rationale_fr: z.string().min(20).max(2_000),
    rationale_en: z.string().min(20).max(2_000),
  }),
  finding_summary: z.object({
    title_fr: z.string().min(3).max(300),
    title_en: z.string().min(3).max(300),
    primary_entity_label: z.string().min(1).max(300),
    amount_xaf: z.number().int().nullable(),
    region: z.string().nullable(),
  }),
  signer: zManifestSigner,
  audit_anchor: zManifestAuditAnchor,
});
export type MinfiPreDisbursementManifestV1 = z.infer<typeof zMinfiPreDisbursementManifestV1>;

/** ANIF AML / PEP suspicion declaration envelope per SRD §28.7.
 *  Per Loi N° 2010/010 the declaration is confidential; manifest excludes
 *  named individuals — only the cryptographic case hash + dossier ref. */
export const zAnifAmlManifestV1 = z.object({
  format_adapter_version: z.literal('v1'),
  recipient_body_name: z.literal('ANIF'),
  declaration_id: z.string().min(8).max(80),
  dossier_number: z.string().regex(/^VA-\d{4}-\d{4,6}$/),
  generated_at: zIsoInstant,
  files: z.array(zManifestFile),
  declaration: z.object({
    classification: z.literal('confidentiel'),
    suspicion_type: z.enum(['pep_match', 'sanctions_exposure', 'unexplained_wealth', 'structuring', 'other']),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    case_hash: zSha256Hex, // sha256 of (entity ids + finding id + salt) — preserves audit linkage without leaking names
    region: z.string().nullable(),
  }),
  signer: zManifestSigner,
  audit_anchor: zManifestAuditAnchor,
});
export type AnifAmlManifestV1 = z.infer<typeof zAnifAmlManifestV1>;

/** Generic envelope for CDC / OTHER recipients (minimal schema; the architect
 *  may pin a body-specific manifest as those agreements are signed). */
export const zGenericManifestV1 = z.object({
  format_adapter_version: z.literal('v1'),
  recipient_body_name: z.enum(['CDC', 'OTHER']),
  dossier_number: z.string().regex(/^VA-\d{4}-\d{4,6}$/),
  generated_at: zIsoInstant,
  files: z.array(zManifestFile),
  finding_summary: z.object({
    title_fr: z.string().min(3).max(300),
    title_en: z.string().min(3).max(300),
    posterior: z.number().min(0).max(1),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    primary_entity_label: z.string().min(1).max(300),
    amount_xaf: z.number().int().nullable(),
    region: z.string().nullable(),
  }),
  signer: zManifestSigner,
  audit_anchor: zManifestAuditAnchor,
});
export type GenericManifestV1 = z.infer<typeof zGenericManifestV1>;

/** Discriminated union of every recipient-body manifest. */
export const zRecipientManifest = z.discriminatedUnion('recipient_body_name', [
  zConacManifestV1.extend({ recipient_body_name: z.literal('CONAC') }),
  zCourDesComptesManifestV1,
  zMinfiPreDisbursementManifestV1,
  zAnifAmlManifestV1,
  zGenericManifestV1,
]);
export type RecipientManifest = z.infer<typeof zRecipientManifest>;
