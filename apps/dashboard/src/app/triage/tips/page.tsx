import { TipRepo, getDb } from '@vigil/db-postgres';

import { getLocale, loadMessages, t } from '../../../lib/i18n.js';

import { TipDecryptForm } from './decrypt-form.js';

export const dynamic = 'force-dynamic';

export default async function TipTriagePage(): Promise<JSX.Element> {
  const locale = getLocale();
  const messages = await loadMessages(locale);

  const db = await getDb();
  const repo = new TipRepo(db);
  const tips = await repo.listForTriage(50);

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t(messages, 'triage.title')}</h1>
        <p className="text-sm text-amber-700 mt-1">{t(messages, 'triage.quorum_required')}</p>
      </header>

      {tips.length === 0 ? (
        <p className="text-gray-500">—</p>
      ) : (
        <ul className="space-y-4">
          {tips.map((tip) => (
            <li key={tip.id} className="border rounded p-4 space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="font-mono">{tip.ref}</span>
                <span className="text-sm text-gray-500">
                  {new Date(tip.received_at).toLocaleString(locale)}
                </span>
              </div>
              <div className="text-xs text-gray-500">
                disposition <span className="font-mono">{tip.disposition}</span>
                {tip.region && <> · region {tip.region}</>}
                {tip.topic_hint && <> · topic {tip.topic_hint}</>}
              </div>

              <TipDecryptForm
                tipId={tip.id}
                labels={{
                  shares: t(messages, 'triage.shares_collected', { count: '{count}' }),
                  decrypt: t(messages, 'triage.decrypt'),
                  promote: t(messages, 'triage.promote'),
                  cancel: t(messages, 'common.cancel'),
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
