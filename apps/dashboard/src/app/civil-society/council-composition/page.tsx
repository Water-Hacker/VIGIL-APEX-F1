import { listCouncilComposition } from '@/lib/civil-society.server';

export const dynamic = 'force-dynamic';

export default async function CouncilCompositionPage(): Promise<JSX.Element> {
  const rows = await listCouncilComposition();
  const filled = rows.filter((r) => r.seat_filled).length;
  return (
    <main>
      <h1>Composition du conseil · Council composition</h1>
      <p style={{ color: 'var(--muted)' }} lang="fr">
        Selon EXEC §08.2, le conseil est un quorum 5-piliers. Cette page affiche uniquement
        l&apos;état des sièges ; les identités individuelles sont publiées via la cérémonie
        d&apos;enrôlement EXEC §13, pas ici.
      </p>
      <p style={{ color: 'var(--muted)' }} lang="en">
        Per EXEC §08.2 the council is a 5-pillar quorum. This page shows seat status only;
        individual identities are published through the EXEC §13 enrolment ceremony, not here.
      </p>
      <p>
        <strong>{filled}/5 sièges occupés · seats filled.</strong>
      </p>
      <table>
        <thead>
          <tr>
            <th>Pilier · Pillar</th>
            <th>Occupé · Filled</th>
            <th>Enrôlement · Enrolled at</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pillar}>
              <td>{r.pillar}</td>
              <td>{r.seat_filled ? 'oui · yes' : 'non · no'}</td>
              <td>{r.enrolled_at ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
