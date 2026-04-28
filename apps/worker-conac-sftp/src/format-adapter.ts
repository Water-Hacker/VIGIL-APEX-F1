import { Schemas } from '@vigil/shared';

/**
 * Format-adapter layer (W-25 fix).
 *
 * Decouples manifest production from the worker so that, after the CONAC
 * engagement letter response, the manifest schema can change without
 * rewriting the worker. New format versions add a new function here; the
 * worker reads the configured `format_adapter_version` and dispatches.
 */

export type FormatAdapterVersion = 'v1' | 'v2-cour-des-comptes';

export interface ManifestInput {
  readonly dossier: Schemas.Dossier;
  readonly finding: Schemas.Finding;
  readonly fr_pdf: { sha256: string; bytes: number };
  readonly en_pdf: { sha256: string; bytes: number };
  readonly evidence_archive: { sha256: string; bytes: number };
  readonly signer: { name: string; pgp_fingerprint: string; signed_at: string };
  readonly audit_anchor: { audit_event_id: string; polygon_tx_hash: string | null };
}

export function buildManifest(input: ManifestInput, version: FormatAdapterVersion): Schemas.ConacManifestV1 {
  switch (version) {
    case 'v1':
      return {
        format_adapter_version: 'v1',
        dossier_number: input.dossier.ref,
        generated_at: new Date().toISOString(),
        files: [
          { filename: `${input.dossier.ref}-fr.pdf`, sha256: input.fr_pdf.sha256, bytes: input.fr_pdf.bytes, kind: 'fr_pdf' },
          { filename: `${input.dossier.ref}-en.pdf`, sha256: input.en_pdf.sha256, bytes: input.en_pdf.bytes, kind: 'en_pdf' },
          { filename: `${input.dossier.ref}-evidence.tar.gz`, sha256: input.evidence_archive.sha256, bytes: input.evidence_archive.bytes, kind: 'evidence_archive' },
          { filename: `${input.dossier.ref}-manifest.json`, sha256: '0'.repeat(64), bytes: 0, kind: 'manifest' },
        ],
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
    case 'v2-cour-des-comptes':
      // Plan-B (W-25): Cour des Comptes ingestion preferences. Currently
      // unspec'd; the architect signs CONAC out, signs CdC in, and a new
      // function lands here. Throws until then.
      throw new Error(
        'v2-cour-des-comptes format not yet specified — see docs/decisions/log.md DECISION-005',
      );
  }
}
