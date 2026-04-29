import { listCouncilComposition } from '@/lib/civil-society.server';

export const dynamic = 'force-dynamic';

export default async function CouncilCompositionPage(): Promise<JSX.Element> {
  const rows = await listCouncilComposition();
  const filled = rows.filter((r) => r.seat_filled).length;
  return (
    <main>
      <h1>Council composition</h1>
      <p style={{ color: 'var(--muted)' }}>
        Per EXEC §08.2 the council is a 5-pillar quorum. This page shows seat
        status only; individual identities are published through the EXEC §13
        enrolment ceremony, not here.
      </p>
      <p>
        <strong>{filled}/5 seats filled.</strong>
      </p>
      <table>
        <thead>
          <tr>
            <th>Pillar</th>
            <th>Seat filled</th>
            <th>Enrolled at</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pillar}>
              <td>{r.pillar}</td>
              <td>{r.seat_filled ? 'yes' : 'no'}</td>
              <td>{r.enrolled_at ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
