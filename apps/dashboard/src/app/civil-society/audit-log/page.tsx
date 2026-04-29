import Link from 'next/link';

import { listAuditLogPage } from '@/lib/civil-society.server';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { cursor?: string };
}

export default async function CivilSocietyAuditLogPage({ searchParams }: PageProps): Promise<JSX.Element> {
  const cursor = searchParams.cursor ? Number(searchParams.cursor) : 0;
  const { rows, nextCursor } = await listAuditLogPage({ cursor, limit: 100 });

  return (
    <main>
      <h1>Audit Log — civil society view</h1>
      <p style={{ color: 'var(--muted)' }}>
        SRD §15 / W-15 — entity identifiers are masked unless a 4-of-5 council
        vote has unmasked the row. The audit chain root is publicly verifiable
        at <Link href="/verify">/verify</Link>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Seq</th>
            <th>Time</th>
            <th>Action</th>
            <th>Actor</th>
            <th>Subject kind</th>
            <th>Subject (masked)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.seq}>
              <td><code>{r.seq}</code></td>
              <td>{r.occurred_at}</td>
              <td>{r.action}</td>
              <td>{r.actor_role}</td>
              <td>{r.subject_kind}</td>
              <td><code>{r.subject_id_masked}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
      {nextCursor !== null && (
        <p>
          <Link href={`/civil-society/audit-log?cursor=${nextCursor}`}>Next 100 →</Link>
        </p>
      )}
    </main>
  );
}
