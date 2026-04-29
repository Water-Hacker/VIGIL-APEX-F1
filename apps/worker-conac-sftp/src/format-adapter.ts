import { Schemas } from '@vigil/shared';

/**
 * Format-adapter layer (W-25 + DECISION-010).
 *
 * Each recipient body has its own manifest schema; this module is the single
 * dispatch point. The worker reads `dossier.recipient_body_name` and calls
 * `buildManifest(input, body)`. New body schemas are added here and in
 * `packages/shared/src/schemas/conac.ts` (the schema source of truth).
 *
 * Per BUILD-COMPANION authority — the previously committed CONAC v1 shape
 * is preserved verbatim; only its dispatch wrapper changed.
 */

export type RecipientBody = Schemas.RecipientBody;

export interface ManifestInput {
  readonly dossier: Schemas.Dossier;
  readonly finding: Schemas.Finding;
  readonly fr_pdf: { sha256: string; bytes: number };
  readonly en_pdf: { sha256: string; bytes: number };
  readonly evidence_archive: { sha256: string; bytes: number };
  readonly signer: { name: string; pgp_fingerprint: string; signed_at: string };
  readonly audit_anchor: { audit_event_id: string; polygon_tx_hash: string | null };
  /** Optional MINFI pre-disbursement linkage; ignored by other bodies. */
  readonly minfi_request_id?: string;
  /** Optional Cour des Comptes chamber routing; default: chambre_des_finances. */
  readonly cdc_target_chamber?:
    | 'chambre_des_finances'
    | 'chambre_des_collectivites'
    | 'chambre_des_etablissements_publics';
  /** Optional Cour des Comptes audit-finding class; default: irregularite_d_execution. */
  readonly cdc_audit_finding_class?:
    | 'gestion_de_fait'
    | 'irregularite_d_engagement'
    | 'irregularite_d_execution'
    | 'depense_sans_service_fait'
    | 'autre';
  /** Optional ANIF declaration metadata. */
  readonly anif_declaration_id?: string;
  readonly anif_suspicion_type?:
    | 'pep_match'
    | 'sanctions_exposure'
    | 'unexplained_wealth'
    | 'structuring'
    | 'other';
  readonly anif_case_hash?: string; // sha256
  /** Optional MINFI advisory verdict (blocks vs informs). */
  readonly minfi_advisory?: 'proceed' | 'review' | 'hold_pending_clarification' | 'do_not_proceed';
}

const COMMON_FILE_LIST = (input: ManifestInput) => [
  {
    filename: `${input.dossier.ref}-fr.pdf`,
    sha256: input.fr_pdf.sha256,
    bytes: input.fr_pdf.bytes,
    kind: 'fr_pdf' as const,
  },
  {
    filename: `${input.dossier.ref}-en.pdf`,
    sha256: input.en_pdf.sha256,
    bytes: input.en_pdf.bytes,
    kind: 'en_pdf' as const,
  },
  {
    filename: `${input.dossier.ref}-evidence.tar.gz`,
    sha256: input.evidence_archive.sha256,
    bytes: input.evidence_archive.bytes,
    kind: 'evidence_archive' as const,
  },
  {
    filename: `${input.dossier.ref}-manifest.json`,
    sha256: '0'.repeat(64),
    bytes: 0,
    kind: 'manifest' as const,
  },
];

function severityFromFinding(finding: Schemas.Finding): 'low' | 'medium' | 'high' | 'critical' {
  return finding.severity as 'low' | 'medium' | 'high' | 'critical';
}

export function buildManifest(
  input: ManifestInput,
  body: RecipientBody,
): Schemas.RecipientManifest {
  const generatedAt = new Date().toISOString();
  const files = COMMON_FILE_LIST(input);

  switch (body) {
    case 'CONAC':
      return {
        format_adapter_version: 'v1',
        recipient_body_name: 'CONAC',
        dossier_number: input.dossier.ref,
        generated_at: generatedAt,
        files,
        finding_summary: {
          title_fr: input.finding.title_fr,
          title_en: input.finding.title_en,
          posterior: input.finding.posterior ?? 0,
          council_yes_votes: input.finding.council_yes_votes,
          council_no_votes: input.finding.council_no_votes,
          primary_entity_label: 'redacted-in-manifest',
          amount_xaf: input.finding.amount_xaf,
          region: input.finding.region,
        },
        signer: input.signer,
        audit_anchor: input.audit_anchor,
      };

    case 'COUR_DES_COMPTES':
      return {
        format_adapter_version: 'v1',
        recipient_body_name: 'COUR_DES_COMPTES',
        reference_dossier: input.dossier.ref,
        emis_le: generatedAt,
        fichiers: files,
        resume_constatation: {
          intitule_fr: input.finding.title_fr,
          intitule_en: input.finding.title_en,
          probabilite_a_posteriori: input.finding.posterior ?? 0,
          votes_oui: input.finding.council_yes_votes,
          votes_non: input.finding.council_no_votes,
          sujet_principal_libelle: 'redacted-in-manifest',
          montant_xaf: input.finding.amount_xaf,
          region: input.finding.region,
          audit_finding_class: input.cdc_audit_finding_class ?? 'irregularite_d_execution',
        },
        chambre_destinataire: input.cdc_target_chamber ?? 'chambre_des_finances',
        signataire: input.signer,
        ancrage_audit: input.audit_anchor,
      };

    case 'MINFI':
      return {
        format_adapter_version: 'v1',
        recipient_body_name: 'MINFI',
        request_id: input.minfi_request_id ?? input.dossier.ref,
        dossier_number: input.dossier.ref,
        generated_at: generatedAt,
        files,
        risk_score: {
          posterior: input.finding.posterior ?? 0,
          severity: severityFromFinding(input.finding),
          advisory: input.minfi_advisory ?? minfiAdvisoryFromPosterior(input.finding.posterior ?? 0),
          rationale_fr: minfiRationaleFr(input.finding),
          rationale_en: minfiRationaleEn(input.finding),
        },
        finding_summary: {
          title_fr: input.finding.title_fr,
          title_en: input.finding.title_en,
          primary_entity_label: 'redacted-in-manifest',
          amount_xaf: input.finding.amount_xaf,
          region: input.finding.region,
        },
        signer: input.signer,
        audit_anchor: input.audit_anchor,
      };

    case 'ANIF':
      return {
        format_adapter_version: 'v1',
        recipient_body_name: 'ANIF',
        declaration_id: input.anif_declaration_id ?? `ANIF-${input.dossier.ref}`,
        dossier_number: input.dossier.ref,
        generated_at: generatedAt,
        files,
        declaration: {
          classification: 'confidentiel',
          suspicion_type: input.anif_suspicion_type ?? 'other',
          severity: severityFromFinding(input.finding),
          case_hash: input.anif_case_hash ?? '0'.repeat(64),
          region: input.finding.region,
        },
        signer: input.signer,
        audit_anchor: input.audit_anchor,
      };

    case 'CDC':
    case 'OTHER':
      return {
        format_adapter_version: 'v1',
        recipient_body_name: body,
        dossier_number: input.dossier.ref,
        generated_at: generatedAt,
        files,
        finding_summary: {
          title_fr: input.finding.title_fr,
          title_en: input.finding.title_en,
          posterior: input.finding.posterior ?? 0,
          severity: severityFromFinding(input.finding),
          primary_entity_label: 'redacted-in-manifest',
          amount_xaf: input.finding.amount_xaf,
          region: input.finding.region,
        },
        signer: input.signer,
        audit_anchor: input.audit_anchor,
      };
  }
}

function minfiAdvisoryFromPosterior(
  posterior: number,
): 'proceed' | 'review' | 'hold_pending_clarification' | 'do_not_proceed' {
  if (posterior >= 0.95) return 'do_not_proceed';
  if (posterior >= 0.85) return 'hold_pending_clarification';
  if (posterior >= 0.55) return 'review';
  return 'proceed';
}

function minfiRationaleFr(finding: Schemas.Finding): string {
  return (
    `Score de risque a posteriori = ${(finding.posterior ?? 0).toFixed(2)} ; ` +
    `signaux contributifs = ${finding.signal_count} ; sévérité = ${finding.severity}. ` +
    `Voir dossier complet ${finding.id}.`
  );
}

function minfiRationaleEn(finding: Schemas.Finding): string {
  return (
    `Posterior risk score = ${(finding.posterior ?? 0).toFixed(2)} ; ` +
    `contributing signals = ${finding.signal_count} ; severity = ${finding.severity}. ` +
    `Refer to full dossier ${finding.id}.`
  );
}
