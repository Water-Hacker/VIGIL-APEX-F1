import Link from 'next/link';

import { Card } from '../components/card';

export default function HomePage(): JSX.Element {
  return (
    <main>
      <h1>VIGIL APEX</h1>
      <p style={{ color: 'var(--muted)' }}>
        Real-Time Public Finance Compliance, Governance Monitoring &amp; Intelligence Platform
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
        <Card title="Operations Room">
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>
            Live findings, deadletter queue, calibration sweep status.
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
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>5-pillar 3-of-5 escalation council.</p>
          <ul>
            <li>
              <Link href="/council/proposals">Council portal</Link>
            </li>
            <li>
              <Link href="/civil-society/audit-log">Civil-society read-only</Link>
            </li>
          </ul>
        </Card>
        <Card title="Public surfaces">
          <p style={{ color: 'var(--muted)', marginTop: 0 }}>
            Citizen-facing portals — anonymous tip submission, dossier verification, public ledger,
            public audit.
          </p>
          <ul>
            <li>
              <Link href="/tip">Submit a tip</Link>
            </li>
            <li>
              <Link href="/tip/status">Check a tip&apos;s status</Link>
            </li>
            <li>
              <Link href="/verify">Verify a dossier</Link>
            </li>
            <li>
              <Link href="/ledger">Public ledger</Link>
            </li>
            <li>
              <Link href="/public/audit">Public audit log</Link>
            </li>
          </ul>
        </Card>
      </div>
    </main>
  );
}
