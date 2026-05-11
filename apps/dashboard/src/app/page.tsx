import { isOperatorTier, parseRolesHeader } from '@vigil/security';
import { headers } from 'next/headers';
import Link from 'next/link';

import { Card } from '../components/card';

import type { Metadata } from 'next';

/**
 * Public landing page. Closes FIND-011 from whole-system-audit doc 10.
 *
 * Branding presents the platform as a public service of the Republic
 * of Cameroon — NOT an "Intelligence Platform" (operator-internal
 * terminology that should not appear on the public front door). The
 * operator-tier cards are conditionally rendered based on the
 * x-vigil-roles header set by middleware, so an anonymous citizen
 * sees only public surfaces (no enumeration of internal routes).
 */

export const metadata: Metadata = {
  title: 'VIGIL APEX · République du Cameroun',
  description:
    'Plateforme publique de conformité financière et de transparence — République du Cameroun · Phase 1 Pilot · Public anti-corruption platform of the Republic of Cameroon · Phase 1 Pilot',
  // Public-facing — discoverable in search.
  robots: 'index, follow',
};

export default function HomePage(): JSX.Element {
  const roles = parseRolesHeader(headers().get('x-vigil-roles'));
  const showOperatorCards = isOperatorTier(roles);

  return (
    <main>
      <h1>VIGIL APEX</h1>
      <p style={{ color: 'var(--muted)' }}>
        Plateforme publique de conformité financière et de transparence
        <br />
        Public anti-corruption platform of the Republic of Cameroon
        <br />
        République du Cameroun · Phase 1 Pilot
      </p>
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          marginTop: 24,
        }}
      >
        {showOperatorCards ? (
          <>
            <Card title="Operations Room">
              <p style={{ color: 'var(--muted)', marginTop: 0 }}>
                Live findings, dead-letter queue, calibration sweep status.
              </p>
              <ul>
                <li>
                  <Link href="/findings">Findings</Link>
                </li>
                <li>
                  <Link href="/dead-letter">Dead-letter queue</Link>
                </li>
                <li>
                  <Link href="/calibration">Calibration</Link>
                </li>
                <li>
                  <Link href="/audit/ai-safety">AI safety audit</Link>
                </li>
                <li>
                  <Link href="/audit/rbac-matrix">RBAC matrix</Link>
                </li>
              </ul>
            </Card>
            <Card title="Triage">
              <p style={{ color: 'var(--muted)', marginTop: 0 }}>
                Decrypted tip queue + adapter-repair approvals.
              </p>
              <ul>
                <li>
                  <Link href="/triage/tips">Tip triage queue</Link>
                </li>
                <li>
                  <Link href="/triage/adapter-repairs">Adapter repairs</Link>
                </li>
              </ul>
            </Card>
            <Card title="Council">
              <p style={{ color: 'var(--muted)', marginTop: 0 }}>
                5-pillar 3-of-5 escalation council.
              </p>
              <ul>
                <li>
                  <Link href="/council/proposals">Council portal</Link>
                </li>
                <li>
                  <Link href="/civil-society/audit-log">Civil-society read-only</Link>
                </li>
              </ul>
            </Card>
          </>
        ) : null}
        <Card title="Surfaces publiques · Public surfaces">
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>
            Portails citoyens — soumission anonyme, vérification de dossier, registre public, audit
            public.
            <br />
            Citizen-facing portals — anonymous tip submission, dossier verification, public ledger,
            public audit.
          </p>
          <ul>
            <li>
              <Link href="/tip">Soumettre un signalement · Submit a tip</Link>
            </li>
            <li>
              <Link href="/tip/status">Vérifier un signalement · Check tip status</Link>
            </li>
            <li>
              <Link href="/verify">Vérifier un dossier · Verify a dossier</Link>
            </li>
            <li>
              <Link href="/ledger">Registre public · Public ledger</Link>
            </li>
            <li>
              <Link href="/public/audit">Journal d&apos;audit public · Public audit log</Link>
            </li>
          </ul>
        </Card>
      </div>
    </main>
  );
}
