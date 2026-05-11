import Link from 'next/link';

import { listClosedProposals } from '@/lib/civil-society.server';

export const dynamic = 'force-dynamic';

export default async function CivilSocietyClosedProposalsPage(): Promise<JSX.Element> {
  const rows = await listClosedProposals(100);
  return (
    <main>
      <h1>Propositions clôturées — vue société civile · Closed proposals — civil society view</h1>
      <p style={{ color: 'var(--muted)' }} lang="fr">
        Décomptes des votes des propositions clôturées. Selon SRD §28.3 + W-15, les noms
        d&apos;entité ne sont pas exposés ici ; l&apos;id de proposition est la référence on-chain.
        Recouper avec Polygon via la transaction liée.
      </p>
      <p style={{ color: 'var(--muted)' }} lang="en">
        Vote tallies for closed governance proposals. Per SRD §28.3 + W-15, entity names are not
        exposed here; the proposal id is the on-chain reference. Cross-check against Polygon at the
        linked transaction.
      </p>
      <table>
        <thead>
          <tr>
            <th>Id proposition · Proposal id</th>
            <th>Clôture · Closed</th>
            <th>Résultat · Outcome</th>
            <th>Oui · Yes</th>
            <th>Non · No</th>
            <th>Abstention · Abstain</th>
            <th>Récusation · Recuse</th>
            <th>Tx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <code>{r.id.slice(0, 8)}…</code>
              </td>
              <td>{r.closed_at}</td>
              <td>{r.state}</td>
              <td>{r.yes_votes}</td>
              <td>{r.no_votes}</td>
              <td>{r.abstain_votes}</td>
              <td>{r.recuse_votes}</td>
              <td>
                {r.closing_tx_hash ? (
                  <Link
                    href={`https://polygonscan.com/tx/${r.closing_tx_hash}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    explorer →
                  </Link>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
