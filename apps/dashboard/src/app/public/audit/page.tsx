import { toPublicView } from '@vigil/audit-log';
import { UserActionEventRepo, getDb } from '@vigil/db-postgres';

import { getLocale } from '../../../lib/i18n';

/**
 * /public/audit — TAL-PA public audit portal.
 *
 * No auth required. The platform's institutional commitment per
 * TAL-PA doctrine §"Public Access Channels" — every authenticated action
 * by every user is browsable here, with PII redacted for protected
 * categories and aggregate patterns visible.
 */
export const dynamic = 'force-dynamic';

const COPY = {
  fr: {
    title: 'Audit public — qui surveille les surveillants',
    description:
      'Toute action effectuée par un utilisateur de VIGIL APEX est enregistrée, signée et ancrée publiquement. Cette page expose les 200 derniers événements et les comptages agrégés par rôle. Les requêtes contenant des données personnelles sont rédigées par catégorie pour préserver la vie privée des cibles, mais l’existence même de la requête reste visible.',
    aggregate: 'Activité agrégée (7 derniers jours)',
    role: 'Rôle',
    category: 'Catégorie',
    total: 'Total',
    events: 'Événements récents',
    when: 'Horodatage',
    type: 'Type',
    cat: 'Cat.',
    target: 'Cible',
    status: 'Résultat',
    anchor: 'Ancre Polygon',
    hi_sig: 'HAUTE IMPORTANCE',
    public_actor: 'public',
    learn_more: 'Plus de détails dans la doctrine TAL-PA-v1.',
    rest_api: 'API REST publique',
  },
  en: {
    title: 'Public audit — who watches the watchers',
    description:
      'Every action taken by a VIGIL APEX user is recorded, signed, and publicly anchored. This page shows the latest 200 events and aggregate counts by role. Queries containing personal data are redacted at the category level to protect target privacy, but the existence of the query remains visible.',
    aggregate: 'Aggregate activity (last 7 days)',
    role: 'Role',
    category: 'Category',
    total: 'Total',
    events: 'Recent events',
    when: 'Timestamp',
    type: 'Type',
    cat: 'Cat.',
    target: 'Target',
    status: 'Result',
    anchor: 'Polygon anchor',
    hi_sig: 'HIGH-SIG',
    public_actor: 'public',
    learn_more: 'Full detail in the TAL-PA-v1 doctrine.',
    rest_api: 'Public REST API',
  },
} as const;

const CATEGORY_LABELS_EN: Record<string, string> = {
  A: 'Authentication',
  B: 'Search & Query',
  C: 'Document Access',
  D: 'Decision & Vote',
  E: 'Data Modification',
  F: 'Configuration',
  G: 'System',
  H: 'External Communication',
  I: 'Public Portal',
  J: 'Failed / Suspicious',
  K: 'Audit-of-Audit',
};

export default async function PublicAuditPage(): Promise<JSX.Element> {
  const locale = getLocale();
  const lang: 'fr' | 'en' = locale === 'fr' ? 'fr' : 'en';
  const t = COPY[lang];

  const sinceIso = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
  const untilIso = new Date().toISOString();

  const db = await getDb();
  const repo = new UserActionEventRepo(db);
  const [aggregate, rows] = await Promise.all([
    repo.aggregateCounts({ sinceIso, untilIso }),
    repo.listPublic({ sinceIso, untilIso, limit: 200, offset: 0 }),
  ]);

  const events = rows.map((r) =>
    toPublicView({
      event_id: r.event_id,
      event_type: r.event_type,
      category: r.category,
      timestamp_utc: r.timestamp_utc,
      actor_id: r.actor_id,
      actor_role: r.actor_role,
      target_resource: r.target_resource,
      result_status: r.result_status,
      chain_anchor_tx: r.chain_anchor_tx,
      high_significance: r.high_significance,
    }),
  );

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-sm text-gray-700 max-w-3xl">{t.description}</p>
        <p className="text-xs text-gray-500 mt-1">
          {t.rest_api}:{' '}
          <code className="font-mono">/api/audit/public</code> •{' '}
          <code className="font-mono">/api/audit/aggregate</code>
        </p>
      </header>

      <section aria-labelledby="aggregate" className="space-y-2">
        <h2 id="aggregate" className="text-xl font-semibold">
          {t.aggregate}
        </h2>
        <table className="w-full text-sm border rounded">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left p-2">{t.role}</th>
              <th className="text-left p-2">{t.category}</th>
              <th className="text-right p-2">{t.total}</th>
            </tr>
          </thead>
          <tbody>
            {aggregate.map((row, i) => (
              <tr key={`${row.role}|${row.category}|${i}`} className="border-t">
                <td className="p-2 font-mono">{row.role}</td>
                <td className="p-2">
                  <span className="text-xs uppercase mr-2">{row.category}</span>
                  {CATEGORY_LABELS_EN[row.category] ?? row.category}
                </td>
                <td className="p-2 text-right tabular-nums">{row.total}</td>
              </tr>
            ))}
            {aggregate.length === 0 && (
              <tr>
                <td colSpan={3} className="p-2 italic text-gray-500">
                  —
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="events" className="space-y-2">
        <h2 id="events" className="text-xl font-semibold">
          {t.events}
        </h2>
        <table className="w-full text-xs border rounded">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left p-1.5">{t.when}</th>
              <th className="text-left p-1.5">{t.cat}</th>
              <th className="text-left p-1.5">{t.type}</th>
              <th className="text-left p-1.5">{t.role}</th>
              <th className="text-left p-1.5">{t.target}</th>
              <th className="text-left p-1.5">{t.status}</th>
              <th className="text-left p-1.5">{t.anchor}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.event_id} className="border-t">
                <td className="p-1.5 font-mono whitespace-nowrap">
                  {typeof e.timestamp_utc === 'string'
                    ? new Date(e.timestamp_utc).toLocaleString(locale)
                    : ''}
                </td>
                <td className="p-1.5">
                  <span className="inline-block px-1.5 rounded bg-gray-100 font-mono text-[10px]">
                    {e.category}
                  </span>
                </td>
                <td className="p-1.5 font-mono">{e.event_type}</td>
                <td className="p-1.5 font-mono">
                  {e.actor_role}
                  {e.actor_authenticated ? '' : ` (${t.public_actor})`}
                </td>
                <td className="p-1.5 font-mono break-all max-w-md">{e.target_resource}</td>
                <td className="p-1.5 font-mono">{e.result_status}</td>
                <td className="p-1.5 font-mono">
                  {e.chain_anchor_tx ? (
                    <a
                      href={`https://polygonscan.com/tx/${e.chain_anchor_tx}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-700 hover:underline"
                    >
                      {e.chain_anchor_tx.slice(0, 10)}…
                    </a>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                  {e.high_significance && (
                    <span className="ml-1 text-[10px] uppercase font-bold text-red-700">
                      {t.hi_sig}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="text-xs text-gray-500">{t.learn_more}</footer>
    </main>
  );
}
