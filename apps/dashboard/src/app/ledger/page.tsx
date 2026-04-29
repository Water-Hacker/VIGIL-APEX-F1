import { getDb } from '@vigil/db-postgres';
import { sql } from 'drizzle-orm';

import { getLocale, loadMessages, t } from '../../lib/i18n';

export const dynamic = 'force-dynamic';

interface DailyCheckpoint {
  date: string;
  seq_to: number;
  polygon_tx_hash: string | null;
}

interface MonthlyCount {
  month: string;
  delivered: number;
  acknowledged: number;
}

async function loadCheckpoints(): Promise<DailyCheckpoint[]> {
  const db = await getDb();
  const r = await db.execute(sql`
    SELECT DATE_TRUNC('day', polygon_confirmed_at)::date::text AS date,
           MAX(seq_to)::text AS seq_to,
           (ARRAY_AGG(polygon_tx_hash::text ORDER BY seq_to DESC))[1] AS tx
      FROM audit.anchor_commitment
     WHERE polygon_confirmed_at IS NOT NULL
       AND polygon_confirmed_at > NOW() - INTERVAL '30 days'
     GROUP BY 1
     ORDER BY 1 DESC
  `);
  return r.rows.map((row) => ({
    date: String(row['date']),
    seq_to: Number(row['seq_to']),
    polygon_tx_hash: row['tx'] ? String(row['tx']) : null,
  }));
}

async function loadMonthly(): Promise<MonthlyCount[]> {
  const db = await getDb();
  const r = await db.execute(sql`
    SELECT TO_CHAR(rendered_at, 'YYYY-MM') AS month,
           COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)     AS delivered,
           COUNT(*) FILTER (WHERE acknowledged_at IS NOT NULL)  AS acknowledged
      FROM dossier.dossier
     WHERE rendered_at > NOW() - INTERVAL '12 months'
     GROUP BY 1
     ORDER BY 1 DESC
  `);
  return r.rows.map((row) => ({
    month: String(row['month']),
    delivered: Number(row['delivered']),
    acknowledged: Number(row['acknowledged']),
  }));
}

export default async function LedgerPage(): Promise<JSX.Element> {
  const locale = getLocale();
  const messages = await loadMessages(locale);
  const polygonExplorer =
    process.env.NEXT_PUBLIC_POLYGON_EXPLORER ?? 'https://polygonscan.com/tx/';

  const [checkpoints, monthly] = await Promise.all([loadCheckpoints(), loadMonthly()]);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t(messages, 'ledger.title')}</h1>
      </header>

      <section aria-labelledby="checkpoints">
        <h2 id="checkpoints" className="text-xl font-semibold mb-2">
          {t(messages, 'ledger.checkpoints')}
        </h2>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500 border-b">
            <tr>
              <th className="py-1">date</th>
              <th className="py-1 text-right">seq</th>
              <th className="py-1">tx</th>
            </tr>
          </thead>
          <tbody>
            {checkpoints.map((c) => (
              <tr key={c.date} className="border-b last:border-0">
                <td className="py-1 tabular-nums">{c.date}</td>
                <td className="py-1 tabular-nums text-right">{c.seq_to}</td>
                <td className="py-1 font-mono text-xs break-all">
                  {c.polygon_tx_hash ? (
                    <a
                      href={`${polygonExplorer}${c.polygon_tx_hash}`}
                      rel="noreferrer noopener"
                      target="_blank"
                      className="underline"
                    >
                      {c.polygon_tx_hash.slice(0, 10)}…
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="monthly">
        <h2 id="monthly" className="text-xl font-semibold mb-2">
          {t(messages, 'ledger.dossiers_per_month')}
        </h2>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500 border-b">
            <tr>
              <th className="py-1">month</th>
              <th className="py-1 text-right">delivered</th>
              <th className="py-1 text-right">ACK</th>
            </tr>
          </thead>
          <tbody>
            {monthly.map((m) => (
              <tr key={m.month} className="border-b last:border-0">
                <td className="py-1 tabular-nums">{m.month}</td>
                <td className="py-1 tabular-nums text-right">{m.delivered}</td>
                <td className="py-1 tabular-nums text-right">{m.acknowledged}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
