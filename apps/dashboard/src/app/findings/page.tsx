import Link from 'next/link';

import { listFindings } from '@/lib/findings.server';

export const dynamic = 'force-dynamic';

export default async function FindingsPage(): Promise<JSX.Element> {
  const rows = await listFindings({ limit: 50 });
  return (
    <main>
      <h1>Findings</h1>
      <p style={{ color: 'var(--muted)' }}>
        Operations Room — findings above 0.55 posterior. SRD §27.3.
      </p>
      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Title</th>
            <th>Severity</th>
            <th>Posterior</th>
            <th>State</th>
            <th>Detected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
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
              <td>{r.state}</td>
              <td>{new Date(r.detected_at).toLocaleString('fr-CM')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
