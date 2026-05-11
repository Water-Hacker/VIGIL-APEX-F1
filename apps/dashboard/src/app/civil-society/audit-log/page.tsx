import Link from 'next/link';

import { listAuditLogPage } from '@/lib/civil-society.server';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { cursor?: string };
}

export default async function CivilSocietyAuditLogPage({
  searchParams,
}: PageProps): Promise<JSX.Element> {
  const cursor = searchParams.cursor ? Number(searchParams.cursor) : 0;
  const { rows, nextCursor } = await listAuditLogPage({ cursor, limit: 100 });

  return (
    <main>
      <h1>Journal d&apos;audit — vue société civile · Audit Log — civil society view</h1>
      <p style={{ color: 'var(--muted)' }} lang="fr">
        SRD §15 / W-15 — les identifiants d&apos;entité sont masqués sauf si un vote 4-de-5 du
        conseil a démasqué la ligne. La racine de la chaîne d&apos;audit est vérifiable publiquement
        à <Link href="/verify">/verify</Link>.
      </p>
      <p style={{ color: 'var(--muted)' }} lang="en">
        SRD §15 / W-15 — entity identifiers are masked unless a 4-of-5 council vote has unmasked the
        row. The audit chain root is publicly verifiable at <Link href="/verify">/verify</Link>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Seq</th>
            <th>Date · Time</th>
            <th>Action</th>
            <th>Acteur · Actor</th>
            <th>Type · Subject kind</th>
            <th>Sujet (masqué) · Subject (masked)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.seq}>
              <td>
                <code>{r.seq}</code>
              </td>
              <td>{r.occurred_at}</td>
              <td>{r.action}</td>
              <td>{r.actor_role}</td>
              <td>{r.subject_kind}</td>
              <td>
                <code>{r.subject_id_masked}</code>
              </td>
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
