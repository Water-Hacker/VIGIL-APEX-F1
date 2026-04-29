import Link from 'next/link';

import { listFindings } from '@/lib/findings.server';

export const dynamic = 'force-dynamic';

function tierBadge(tier: string | null): { label: string; tone: string } | null {
  if (tier === null) return null;
  if (tier === 'action_queue') return { label: 'ACTION', tone: '#fee2e2;color:#7f1d1d' };
  if (tier === 'investigation_queue') return { label: 'INVEST', tone: '#fef3c7;color:#78350f' };
  return { label: 'LOG', tone: '#f3f4f6;color:#374151' };
}

export default async function FindingsPage(): Promise<JSX.Element> {
  const rows = await listFindings({ limit: 50 });
  return (
    <main>
      <h1>Findings</h1>
      <p style={{ color: 'var(--muted)' }}>
        Operations Room — findings above 0.55 posterior. SRD §27.3 + AI-SAFETY-DOCTRINE-v1 §A.4.
      </p>
      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Title</th>
            <th>Severity</th>
            <th>Posterior</th>
            <th>Tier</th>
            <th>State</th>
            <th>Detected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const tier = tierBadge(r.tier);
            return (
              <tr key={r.id}>
                <td><Link href={`/findings/${r.id}`}>{r.id.slice(0, 8)}</Link></td>
                <td>{r.title_fr}</td>
                <td><span className={`classification-banner cls-${r.severity === 'critical' ? 'restreint' : r.severity === 'high' ? 'confidentiel' : 'public'}`}>{r.severity}</span></td>
                <td>
                  <div style={{ width: 120 }}>
                    <div className="posterior-bar"><div style={{ width: `${(r.posterior ?? 0) * 100}%` }} /></div>
                    <small>{(r.posterior ?? 0).toFixed(2)}</small>
                  </div>
                </td>
                <td>
                  {tier ? (
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        padding: '0.1rem 0.4rem',
                        borderRadius: 4,
                        background: tier.tone.split(';')[0],
                        color: tier.tone.split(';')[1]?.replace('color:', '') ?? '#000',
                      }}
                    >
                      {tier.label}
                    </span>
                  ) : (
                    <small style={{ color: 'var(--muted)' }}>—</small>
                  )}
                </td>
                <td>{r.state}</td>
                <td>{new Date(r.detected_at).toLocaleString('fr-CM')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
