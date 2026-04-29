import { notFound } from 'next/navigation';

import { getLocale, loadMessages, t } from '../../../lib/i18n';
import { getFindingDetail } from '../../../lib/findings.server';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

function PosteriorBar({ value }: { value: number | null }): JSX.Element {
  if (value === null) {
    return <div className="text-sm text-gray-500">—</div>;
  }
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.85 ? 'bg-red-600' : value >= 0.55 ? 'bg-orange-500' : value >= 0.3 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="w-full max-w-xs">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Posterior ${pct}%`}
        className="h-3 rounded bg-gray-200 overflow-hidden"
      >
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-sm mt-1 tabular-nums">{pct}%</div>
    </div>
  );
}

export default async function FindingDetailPage({ params }: PageProps): Promise<JSX.Element> {
  const detail = await getFindingDetail(params.id);
  if (!detail) notFound();

  const locale = getLocale();
  const messages = await loadMessages(locale);
  const f = detail.finding;
  const title = locale === 'fr' ? f.title_fr : f.title_en;
  const summary = locale === 'fr' ? f.summary_fr : f.summary_en;

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <span className="text-sm text-gray-500 tabular-nums">
          {t(messages, 'findings.detected_at')}: {new Date(f.detected_at).toLocaleString(locale)}
        </span>
      </header>

      <section aria-labelledby="finding-meta" className="grid grid-cols-2 md:grid-cols-4 gap-4 border rounded p-4">
        <h2 id="finding-meta" className="sr-only">
          {t(messages, 'findings.title')}
        </h2>
        <dl>
          <dt className="text-xs uppercase text-gray-500">{t(messages, 'findings.posterior')}</dt>
          <dd>
            <PosteriorBar value={f.posterior} />
          </dd>
        </dl>
        <dl>
          <dt className="text-xs uppercase text-gray-500">{t(messages, 'findings.severity')}</dt>
          <dd className="font-medium">{f.severity}</dd>
        </dl>
        <dl>
          <dt className="text-xs uppercase text-gray-500">{t(messages, 'findings.signal_count')}</dt>
          <dd className="font-medium tabular-nums">{f.signal_count}</dd>
        </dl>
        <dl>
          <dt className="text-xs uppercase text-gray-500">{t(messages, 'findings.state')}</dt>
          <dd className="font-medium">{f.state}</dd>
        </dl>
      </section>

      <section aria-labelledby="finding-summary" className="prose max-w-none">
        <h2 id="finding-summary" className="text-xl font-semibold">
          {t(messages, 'app.tagline')}
        </h2>
        <p>{summary}</p>
      </section>

      <section aria-labelledby="finding-entities">
        <h2 id="finding-entities" className="text-xl font-semibold mb-2">
          {t(messages, 'findings.detail.entities')}
        </h2>
        {detail.entities.length === 0 ? (
          <p className="text-gray-500">—</p>
        ) : (
          <ul className="divide-y border rounded">
            {detail.entities.map((e) => (
              <li key={e.id} className="px-4 py-2 flex items-baseline gap-3">
                <span className="font-medium">{e.display_name}</span>
                <span className="text-xs uppercase text-gray-500">{e.kind}</span>
                {e.rccm_number && <span className="text-sm tabular-nums text-gray-600">RCCM {e.rccm_number}</span>}
                {e.is_pep && (
                  <span className="ml-auto text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900">PEP</span>
                )}
                {e.is_sanctioned && (
                  <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-900">SANCTIONED</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="finding-signals">
        <h2 id="finding-signals" className="text-xl font-semibold mb-2">
          {t(messages, 'findings.detail.signals')}
        </h2>
        <ul className="divide-y border rounded">
          {detail.signals.map((s) => (
            <li key={s.id} className="px-4 py-3 space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-sm">{s.pattern_id ?? s.source}</span>
                <span className="text-sm tabular-nums">strength {(s.strength * 100).toFixed(0)}%</span>
              </div>
              {s.rationale && <p className="text-sm text-gray-700">{s.rationale}</p>}
              {s.evidence_document_cids.length > 0 && (
                <p className="text-xs text-gray-500 font-mono break-all">
                  CIDs: {s.evidence_document_cids.join(', ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {f.counter_evidence && (
        <section aria-labelledby="finding-counter">
          <h2 id="finding-counter" className="text-xl font-semibold mb-2">
            {t(messages, 'findings.detail.counter_evidence')}
          </h2>
          <pre className="whitespace-pre-wrap border rounded p-4 bg-gray-50 text-sm">{f.counter_evidence}</pre>
        </section>
      )}

      {detail.dossiers.length > 0 && (
        <section aria-labelledby="finding-dossier">
          <h2 id="finding-dossier" className="text-xl font-semibold mb-2">
            {t(messages, 'findings.detail.dossier')}
          </h2>
          <ul className="divide-y border rounded">
            {detail.dossiers.map((d) => (
              <li key={d.id} className="px-4 py-2 flex items-baseline gap-3">
                <span className="font-mono">{d.ref}</span>
                <span className="text-xs uppercase">{d.language}</span>
                <span className="text-sm">{d.status}</span>
                {d.pdf_cid && <span className="ml-auto text-xs font-mono break-all">{d.pdf_cid}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
