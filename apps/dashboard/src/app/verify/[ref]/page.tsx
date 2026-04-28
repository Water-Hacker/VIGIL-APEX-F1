import { notFound } from 'next/navigation';

import { getLocale, loadMessages, t } from '../../../lib/i18n.js';
import { getVerifyView } from '../../../lib/verify.server.js';

import { HashCheckWidget } from './hash-check.js';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { ref: string };
}

export default async function VerifyDetailPage({ params }: PageProps): Promise<JSX.Element> {
  const view = await getVerifyView(params.ref);
  if (!view) notFound();

  const locale = getLocale();
  const messages = await loadMessages(locale);
  const polygonExplorer =
    process.env.NEXT_PUBLIC_POLYGON_EXPLORER ?? 'https://polygonscan.com/tx/';

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">
          {t(messages, 'verify.title')} · {view.ref}
        </h1>
        <p className="text-sm text-gray-600">{t(messages, 'verify.subtitle')}</p>
      </header>

      <section aria-labelledby="dossier-versions">
        <h2 id="dossier-versions" className="text-xl font-semibold mb-2">
          Dossier
        </h2>
        <ul className="divide-y border rounded">
          {view.languages.map((d) => (
            <li key={d.language} className="px-4 py-3 space-y-1">
              <div className="flex items-baseline gap-3">
                <span className="text-xs uppercase font-mono">{d.language}</span>
                <span className="text-sm">
                  rendered {new Date(d.rendered_at).toLocaleString(locale)}
                </span>
                {d.acknowledged_at && (
                  <span className="ml-auto text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-900">
                    ACK {new Date(d.acknowledged_at).toLocaleDateString(locale)}
                  </span>
                )}
              </div>
              <div className="text-xs font-mono break-all">
                <span className="text-gray-500">SHA-256: </span>
                {d.pdf_sha256}
              </div>
              {d.pdf_cid && (
                <div className="text-xs font-mono break-all">
                  <span className="text-gray-500">{t(messages, 'verify.cid_label')}: </span>
                  {d.pdf_cid}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="anchor" className="border rounded p-4 space-y-2">
        <h2 id="anchor" className="text-xl font-semibold">
          Polygon
        </h2>
        {view.anchor.polygon_tx_hash ? (
          <>
            <div className="text-xs font-mono break-all">
              <span className="text-gray-500">{t(messages, 'verify.tx_label')}: </span>
              <a
                href={`${polygonExplorer}${view.anchor.polygon_tx_hash}`}
                rel="noreferrer noopener"
                target="_blank"
                className="underline"
              >
                {view.anchor.polygon_tx_hash}
              </a>
            </div>
            <div className="text-xs font-mono break-all">
              <span className="text-gray-500">root: </span>
              {view.anchor.root_hash}
            </div>
            <div className="text-xs">
              <span className="text-gray-500">range: </span>
              [{view.anchor.seq_from}, {view.anchor.seq_to}]
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-500">— pas encore ancré / not yet anchored</p>
        )}
      </section>

      <HashCheckWidget
        expectedSha256={view.languages[0]?.pdf_sha256 ?? ''}
        labels={{
          uploadHash: t(messages, 'verify.upload_hash'),
          match: t(messages, 'verify.upload_match'),
          mismatch: t(messages, 'verify.upload_mismatch'),
        }}
      />
    </main>
  );
}
