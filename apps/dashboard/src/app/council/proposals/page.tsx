import { listOpenProposals } from '@/lib/governance.server';

/**
 * Council open-proposals view. Bilingual labels (FR primary, EN
 * secondary) closes the /council portion of FIND-010 from
 * whole-system-audit doc 10.
 */
export const dynamic = 'force-dynamic';

export default async function CouncilProposalsPage(): Promise<JSX.Element> {
  const rows = await listOpenProposals();
  return (
    <main>
      <h1>Conseil — propositions ouvertes · Council — open proposals</h1>
      <p style={{ color: 'var(--muted)' }} lang="fr">
        Les membres du conseil votent avec une clé matérielle. 3-de-5 affirmatifs déclenchent
        l&apos;escalade ; 4-de-5 pour publication. Fenêtre de vote de 14 jours (SRD §23.4).
      </p>
      <p style={{ color: 'var(--muted)' }} lang="en">
        Council members vote with a hardware key. 3-of-5 affirmative escalates; 4-of-5 for public
        release. 14-day vote window per SRD §23.4.
      </p>
      <table>
        <thead>
          <tr>
            <th>Index on-chain · On-chain index</th>
            <th>Conclusion · Finding</th>
            <th>Ouvert · Opened</th>
            <th>Clôture · Closes</th>
            <th>Décompte · Tally</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>
                <a href={`/council/proposals/${p.on_chain_index}`}>#{p.on_chain_index}</a>
              </td>
              <td>{p.finding_id.slice(0, 8)}…</td>
              <td>{new Date(p.opened_at).toLocaleString('fr-CM')}</td>
              <td>{new Date(p.closes_at).toLocaleString('fr-CM')}</td>
              <td>
                OUI/YES {p.yes_votes} · NON/NO {p.no_votes} · ABS {p.abstain_votes} · REC{' '}
                {p.recuse_votes}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
