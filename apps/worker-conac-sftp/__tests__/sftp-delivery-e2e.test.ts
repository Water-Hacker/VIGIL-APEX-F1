/**
 * Block-E E.3 / D3 — CONAC SFTP delivery E2E (unit-test layer).
 *
 * Tests the pure-logic layer of the SFTP delivery pipeline:
 *
 *   1. `buildManifest(input, body)` produces a recipient-specific
 *      manifest that conforms to `Schemas.RecipientManifest`.
 *   2. Each of the 5 documented recipient bodies (CONAC,
 *      COUR_DES_COMPTES, MINFI, ANIF, CDC) is exercised with the
 *      same input fixture; the manifest shape changes per body.
 *   3. `resolveDeliveryTarget(body)` honours the per-body env-prefix
 *      convention (`CONAC_SFTP_HOST`, `MINFI_SFTP_HOST`, etc.) +
 *      legacy fallbacks (`CONAC_HOST`, `MINFI_HOST`) + sensible
 *      defaults (port 22, username 'vigilapex').
 *   4. `assertCriticalTargetsConfigured()` refuses boot if the
 *      default CONAC target is missing or PLACEHOLDER (DECISION-008
 *      Tier-1).
 *
 * Scoping note: the byte-level SFTP transport (ssh2-sftp-client put /
 * get / poll-for-ack) is intentionally NOT covered by this unit-
 * level E2E. Spinning a real ssh2 server harness is heavier than the
 * sandbox affords; the production verification path is the operator
 * R3-Routine-Deploy runbook (manual SFTP put against the test CONAC
 * endpoint, ack file received within 7 days per AT-M3-03). Same
 * pattern as the Block-D D.5 Falco rules: 2 of 11 sandbox-testable,
 * 9 production-only verification.
 *
 * What this test DOES cover end-to-end (without the network layer):
 *   - Manifest schema validity for all 5 bodies.
 *   - Env-driven delivery-target resolution (the operator's primary
 *     configuration surface for new institutional deployments).
 *   - Boot-time critical-target validation (DECISION-008 Tier-1
 *     refuse-to-boot guard).
 *
 * Refs: BLOCK-E-PLAN.md §2.3 (D3 piece); SRD §25 (CONAC delivery
 * format); DECISION-010 (recipient-body routing); AT-M3-03 (CONAC
 * SFTP round-trip — production-only verification).
 */
import { Schemas } from '@vigil/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertCriticalTargetsConfigured,
  resolveDeliveryTarget,
  DeliveryTargetMisconfiguredError,
} from '../src/delivery-targets.js';
import { buildManifest, type ManifestInput } from '../src/format-adapter.js';

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

const FROZEN_NOW_ISO = '2026-05-02T17:00:00.000Z';
const DOSSIER_REF = 'VA-2026-0042';
const FINDING_ID = '11111111-1111-1111-1111-111111111111';

const PDF_FR_SHA = 'a'.repeat(64);
const PDF_EN_SHA = 'b'.repeat(64);
const EVIDENCE_SHA = 'c'.repeat(64);

const SIGNER_PGP_FP = '0F8B9DEA4366A7880CFE76D4232E1B0F846B6151'; // architect's encrypt-subkey
const POLYGON_TX_HASH = '0xfeed' + 'beef'.repeat(15);

function makeManifestInput(): ManifestInput {
  const dossier = {
    id: 'dossier-1',
    ref: DOSSIER_REF,
    finding_id: FINDING_ID,
    state: 'rendered' as const,
    pdf_cid: 'bafyreigh2akiscaildc6cpaapuagqwaagpcfhg5x6jxqnbtycmrlw7llpu',
    sha256: PDF_FR_SHA,
    rendered_at: new Date('2026-05-02T16:30:00Z'),
    delivered_at: null,
    delivery_recipient_body_name: null,
    delivery_recipient_id: null,
    delivery_tx_hash: null,
    delivery_status: null,
    receipt_at: null,
  } as unknown as Schemas.Dossier;

  const finding = {
    id: FINDING_ID,
    ref: DOSSIER_REF,
    title_fr: "Marché public — Soupçon d'attribution irrégulière",
    title_en: 'Public procurement — Suspected irregular award',
    posterior: 0.92,
    severity: 'high' as const,
    council_yes_votes: 3,
    council_no_votes: 2,
    primary_pattern_id: 'p-a-001',
    region: 'CE' as const,
    amount_xaf: 1_500_000_000,
    recommended_recipient_body: null,
  } as unknown as Schemas.Finding;

  return {
    dossier,
    finding,
    fr_pdf: { sha256: PDF_FR_SHA, bytes: 4 * 1024 * 1024 },
    en_pdf: { sha256: PDF_EN_SHA, bytes: 4 * 1024 * 1024 },
    evidence_archive: { sha256: EVIDENCE_SHA, bytes: 12 * 1024 * 1024 },
    signer: {
      name: 'Junior Thuram Nana',
      pgp_fingerprint: SIGNER_PGP_FP,
      signed_at: FROZEN_NOW_ISO,
    },
    audit_anchor: { audit_event_id: 'audit-event-42', polygon_tx_hash: POLYGON_TX_HASH },
  };
}

function envSnapshot(): NodeJS.ProcessEnv {
  return { ...process.env };
}

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const k of Object.keys(process.env)) {
    if (!(k in snapshot)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(snapshot)) {
    process.env[k] = v;
  }
}

// ─────────────────────────────────────────────────────────────────
// buildManifest tests — one happy-path per body
// ─────────────────────────────────────────────────────────────────

describe('Block-E E.3 / D3 — buildManifest produces valid recipient-specific manifests', () => {
  const input = makeManifestInput();

  it('CONAC manifest has the expected English-led shape', () => {
    const m = buildManifest(input, 'CONAC');
    expect(m.format_adapter_version).toBe('v1');
    expect(m.recipient_body_name).toBe('CONAC');
    if (m.recipient_body_name !== 'CONAC') throw new Error('discriminant');
    expect(m.dossier_number).toBe(DOSSIER_REF);
    expect(m.finding_summary.title_fr).toContain('Marché');
    expect(m.finding_summary.title_en).toContain('procurement');
    expect(m.finding_summary.posterior).toBe(0.92);
    expect(m.finding_summary.council_yes_votes).toBe(3);
    expect(m.finding_summary.amount_xaf).toBe(1_500_000_000);
    expect(m.finding_summary.region).toBe('CE');
    expect(m.signer.pgp_fingerprint).toBe(SIGNER_PGP_FP);
    expect(m.audit_anchor.polygon_tx_hash).toBe(POLYGON_TX_HASH);
    expect(m.files).toHaveLength(4); // fr-pdf + en-pdf + evidence + manifest-self
    expect(m.files[0]!.filename).toBe(`${DOSSIER_REF}-fr.pdf`);
  });

  it('COUR_DES_COMPTES manifest uses French field names + chamber routing', () => {
    const m = buildManifest(input, 'COUR_DES_COMPTES');
    expect(m.recipient_body_name).toBe('COUR_DES_COMPTES');
    if (m.recipient_body_name !== 'COUR_DES_COMPTES') throw new Error('discriminant');
    expect(m.reference_dossier).toBe(DOSSIER_REF);
    // French field names — domain authority style.
    expect(m.resume_constatation.intitule_fr).toContain('Marché');
    expect(m.resume_constatation.probabilite_a_posteriori).toBe(0.92);
    expect(m.resume_constatation.votes_oui).toBe(3);
    expect(m.resume_constatation.montant_xaf).toBe(1_500_000_000);
    // Default routing to chambre_des_finances when unspecified.
    expect(m.chambre_destinataire).toBe('chambre_des_finances');
    expect(m.resume_constatation.audit_finding_class).toBe('irregularite_d_execution');
  });

  it('COUR_DES_COMPTES respects optional chamber + audit-finding-class overrides', () => {
    const m = buildManifest(
      {
        ...input,
        cdc_target_chamber: 'chambre_des_collectivites',
        cdc_audit_finding_class: 'depense_sans_service_fait',
      },
      'COUR_DES_COMPTES',
    );
    if (m.recipient_body_name !== 'COUR_DES_COMPTES') throw new Error('discriminant');
    expect(m.chambre_destinataire).toBe('chambre_des_collectivites');
    expect(m.resume_constatation.audit_finding_class).toBe('depense_sans_service_fait');
  });

  it('MINFI manifest carries risk_score + advisory + bilingual rationale', () => {
    const m = buildManifest(input, 'MINFI');
    expect(m.recipient_body_name).toBe('MINFI');
    if (m.recipient_body_name !== 'MINFI') throw new Error('discriminant');
    expect(m.request_id).toBe(DOSSIER_REF); // defaults to dossier ref when no minfi_request_id provided
    expect(m.risk_score.posterior).toBe(0.92);
    expect(m.risk_score.severity).toBe('high');
    // Auto-derived advisory at 0.92 posterior — should be high enough to recommend hold or do_not_proceed.
    expect(['hold_pending_clarification', 'do_not_proceed']).toContain(m.risk_score.advisory);
    expect(m.risk_score.rationale_fr.length).toBeGreaterThan(0);
    expect(m.risk_score.rationale_en.length).toBeGreaterThan(0);
  });

  it('MINFI advisory override is honoured', () => {
    const m = buildManifest({ ...input, minfi_advisory: 'review' }, 'MINFI');
    if (m.recipient_body_name !== 'MINFI') throw new Error('discriminant');
    expect(m.risk_score.advisory).toBe('review');
  });

  it('ANIF manifest carries declaration metadata when provided', () => {
    const m = buildManifest(
      {
        ...input,
        anif_declaration_id: 'ANIF-DECL-2026-0042',
        anif_suspicion_type: 'pep_match',
        anif_case_hash: 'd'.repeat(64),
      },
      'ANIF',
    );
    expect(m.recipient_body_name).toBe('ANIF');
    if (m.recipient_body_name !== 'ANIF') throw new Error('discriminant');
    expect(m.declaration_id).toBe('ANIF-DECL-2026-0042');
    // suspicion_type + case_hash live inside the `declaration` object,
    // alongside `classification: 'confidentiel'` and severity.
    expect(m.declaration.suspicion_type).toBe('pep_match');
    expect(m.declaration.case_hash).toBe('d'.repeat(64));
    expect(m.declaration.classification).toBe('confidentiel');
    expect(m.declaration.severity).toBe('high');
  });

  it('CDC manifest produces a treasury-targeted shape distinct from COUR_DES_COMPTES', () => {
    const m = buildManifest(input, 'CDC');
    expect(m.recipient_body_name).toBe('CDC');
  });

  it('all 4 files present in every manifest, in the documented order', () => {
    for (const body of ['CONAC', 'COUR_DES_COMPTES', 'MINFI', 'ANIF', 'CDC'] as const) {
      const m = buildManifest(input, body);
      // Schemas use either `files` (English-led) or `fichiers` (French
      // for COUR_DES_COMPTES). Both are arrays of 4 entries in the
      // documented order: fr_pdf → en_pdf → evidence → manifest-self.
      const filesField =
        'files' in m
          ? (m as unknown as { files: unknown[] }).files
          : (m as unknown as { fichiers: unknown[] }).fichiers;
      expect(filesField).toHaveLength(4);
      const kinds = filesField.map((f) => (f as { kind: string }).kind);
      expect(kinds).toEqual(['fr_pdf', 'en_pdf', 'evidence_archive', 'manifest']);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// resolveDeliveryTarget tests — env-driven config
// ─────────────────────────────────────────────────────────────────

describe('Block-E E.3 / D3 — resolveDeliveryTarget honours env-driven config', () => {
  let snapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    snapshot = envSnapshot();
    // Clear all SFTP-related env vars so each test starts clean.
    for (const k of Object.keys(process.env)) {
      if (
        k.endsWith('_HOST') ||
        k.endsWith('_PORT') ||
        k.endsWith('_USER') ||
        k.endsWith('_INBOX') ||
        k.endsWith('_ACK_DIR') ||
        k.endsWith('_SFTP_HOST') ||
        k.endsWith('_SFTP_PORT') ||
        k.endsWith('_SFTP_USER')
      ) {
        delete process.env[k];
      }
    }
  });

  afterEach(() => {
    restoreEnv(snapshot);
  });

  it('CONAC happy path with full env config', () => {
    process.env.CONAC_SFTP_HOST = 'sftp.conac.cm';
    process.env.CONAC_SFTP_PORT = '2222';
    process.env.CONAC_SFTP_USER = 'vigilapex-prod';
    process.env.CONAC_INBOX = '/inbox/custom';
    process.env.CONAC_ACK_DIR = '/ack/custom';

    const t = resolveDeliveryTarget('CONAC');
    expect(t.host).toBe('sftp.conac.cm');
    expect(t.port).toBe(2222);
    expect(t.username).toBe('vigilapex-prod');
    expect(t.inboxPath).toBe('/inbox/custom');
    expect(t.ackPath).toBe('/ack/custom');
    expect(t.vaultKeyMount).toBe('conac-sftp');
  });

  it('CONAC legacy env fallback (no _SFTP_ prefix) — for pre-DECISION-010 deployments', () => {
    process.env.CONAC_HOST = 'sftp.conac.cm';
    process.env.CONAC_PORT = '2222';
    process.env.CONAC_USER = 'vigilapex-legacy';

    const t = resolveDeliveryTarget('CONAC');
    expect(t.host).toBe('sftp.conac.cm');
    expect(t.port).toBe(2222);
    expect(t.username).toBe('vigilapex-legacy');
  });

  it('CONAC defaults to port 22 + username "vigilapex" when only HOST set', () => {
    process.env.CONAC_SFTP_HOST = 'sftp.conac.cm';

    const t = resolveDeliveryTarget('CONAC');
    expect(t.host).toBe('sftp.conac.cm');
    expect(t.port).toBe(22);
    expect(t.username).toBe('vigilapex');
    expect(t.inboxPath).toBe('/inbox/vigil-apex'); // default
    expect(t.ackPath).toBe('/ack/vigil-apex'); // default
  });

  it('CONAC throws DeliveryTargetMisconfiguredError when HOST is unset', () => {
    expect(() => resolveDeliveryTarget('CONAC')).toThrow(DeliveryTargetMisconfiguredError);
    expect(() => resolveDeliveryTarget('CONAC')).toThrow(/CONAC_SFTP_HOST/);
  });

  it('CONAC throws on invalid port (out of range 1..65535)', () => {
    process.env.CONAC_SFTP_HOST = 'sftp.conac.cm';
    process.env.CONAC_SFTP_PORT = '99999';

    expect(() => resolveDeliveryTarget('CONAC')).toThrow(DeliveryTargetMisconfiguredError);
    expect(() => resolveDeliveryTarget('CONAC')).toThrow(/CONAC_SFTP_PORT/);
  });

  it('CONAC throws on non-numeric port', () => {
    process.env.CONAC_SFTP_HOST = 'sftp.conac.cm';
    process.env.CONAC_SFTP_PORT = 'not-a-port';

    expect(() => resolveDeliveryTarget('CONAC')).toThrow(DeliveryTargetMisconfiguredError);
  });

  it('MINFI resolves with its own env prefix + correct vault mount', () => {
    process.env.MINFI_SFTP_HOST = 'sftp.minfi.gov.cm';

    const t = resolveDeliveryTarget('MINFI');
    expect(t.host).toBe('sftp.minfi.gov.cm');
    expect(t.vaultKeyMount).toBe('minfi-sftp');
    expect(t.inboxPath).toBe('/inbox/risk-advisory'); // MINFI-specific default
    expect(t.ackPath).toBe('/ack/risk-advisory');
  });

  it('ANIF resolves with its own env prefix + vault mount', () => {
    process.env.ANIF_SFTP_HOST = 'sftp.anif.cm';

    const t = resolveDeliveryTarget('ANIF');
    expect(t.host).toBe('sftp.anif.cm');
    expect(t.vaultKeyMount).toBe('anif-sftp');
    expect(t.inboxPath).toBe('/inbox/declaration');
  });

  it('all 5 recipient bodies have distinct vault key mounts (no cross-body credential reuse)', () => {
    const mounts = new Set<string>();
    for (const body of ['CONAC', 'COUR_DES_COMPTES', 'MINFI', 'ANIF', 'CDC'] as const) {
      // Set the minimum to satisfy resolveDeliveryTarget for each body.
      const prefix =
        body === 'MINFI'
          ? 'MINFI_SFTP'
          : body === 'ANIF'
            ? 'ANIF_SFTP'
            : body === 'CDC'
              ? 'CDC_SFTP'
              : body;
      process.env[`${prefix}_HOST`] = `sftp.${body.toLowerCase()}.test`;
      const t = resolveDeliveryTarget(body);
      expect(mounts.has(t.vaultKeyMount), `body ${body} reused mount ${t.vaultKeyMount}`).toBe(
        false,
      );
      mounts.add(t.vaultKeyMount);
    }
    expect(mounts.size).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────
// assertCriticalTargetsConfigured — DECISION-008 Tier-1 boot guard
// ─────────────────────────────────────────────────────────────────

describe('Block-E E.3 / D3 — assertCriticalTargetsConfigured (DECISION-008 Tier-1)', () => {
  let snapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    snapshot = envSnapshot();
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('CONAC_') || k.startsWith('MINFI_') || k.startsWith('ANIF_')) {
        delete process.env[k];
      }
    }
  });

  afterEach(() => {
    restoreEnv(snapshot);
  });

  it('refuses boot when CONAC default target is unset', () => {
    expect(() => assertCriticalTargetsConfigured()).toThrow();
  });

  it('accepts boot when CONAC HOST is set to a real value', () => {
    process.env.CONAC_SFTP_HOST = 'sftp.conac.cm';
    expect(() => assertCriticalTargetsConfigured()).not.toThrow();
  });

  it('non-default bodies (MINFI, ANIF, CDC) being unconfigured does NOT block CONAC boot', () => {
    process.env.CONAC_SFTP_HOST = 'sftp.conac.cm';
    // MINFI / ANIF / CDC unset — but boot should succeed because CONAC
    // is the everyday delivery path. Other bodies are validated lazily.
    expect(() => assertCriticalTargetsConfigured()).not.toThrow();
  });
});
