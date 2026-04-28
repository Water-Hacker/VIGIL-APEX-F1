import { listOpenProposals } from '@/lib/governance.server';

export const dynamic = 'force-dynamic';

export default async function CouncilProposalsPage(): Promise<JSX.Element> {
  const rows = await listOpenProposals();
  return (
    <main>
      <h1>Council — open proposals</h1>
      <p style={{ color: 'var(--muted)' }}>
        Council members vote with a hardware key. 3-of-5 affirmative escalates; 4-of-5 for public release.
        14-day vote window per SRD §23.4.
      </p>
      <table>
        <thead>
          <tr>
            <th>On-chain index</th>
            <th>Finding</th>
            <th>Opened</th>
            <th>Closes</th>
            <th>Tally</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td><a href={`/council/proposals/${p.on_chain_index}`}>#{p.on_chain_index}</a></td>
              <td>{p.finding_id.slice(0, 8)}…</td>
              <td>{new Date(p.opened_at).toLocaleString('fr-CM')}</td>
              <td>{new Date(p.closes_at).toLocaleString('fr-CM')}</td>
              <td>YES {p.yes_votes} · NO {p.no_votes} · ABS {p.abstain_votes} · REC {p.recuse_votes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
