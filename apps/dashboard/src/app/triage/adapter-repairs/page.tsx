import { getLocale, loadMessages, t } from '../../../lib/i18n';
import { listPendingProposals } from '../../../lib/adapter-repair.server';

import { DecisionForm } from './decision-form';

export const dynamic = 'force-dynamic';

export default async function AdapterRepairsPage(): Promise<JSX.Element> {
  const locale = getLocale();
  const messages = await loadMessages(locale);
  const proposals = await listPendingProposals();

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Adapter repairs</h1>
        <p className="text-sm text-gray-500">
          {proposals.length} candidate{proposals.length === 1 ? '' : 's'} awaiting decision
        </p>
      </header>

      {proposals.length === 0 ? (
        <p className="text-gray-500">{t(messages, 'common.search')} — none pending.</p>
      ) : (
        <ul className="space-y-4">
          {proposals.map((p) => {
            const matchPct =
              p.shadow_match_rate === null ? '—' : `${(p.shadow_match_rate * 100).toFixed(1)}%`;
            const divPct =
              p.shadow_divergence_rate === null
                ? '—'
                : `${(p.shadow_divergence_rate * 100).toFixed(1)}%`;
            return (
              <li key={p.id} className="border rounded p-4 space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-sm">{p.source_id}</span>
                  <span className="text-xs text-gray-500">
                    {new Date(p.generated_at).toLocaleString(locale)}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  status <span className="font-mono">{p.status}</span> · model{' '}
                  <span className="font-mono">{p.generated_by_llm}</span> · shadow{' '}
                  <span className="tabular-nums">{p.shadow_count}/48</span> · match{' '}
                  <span className="tabular-nums">{matchPct}</span> · divergence{' '}
                  <span className="tabular-nums">{divPct}</span>
                </div>
                {p.rationale && <p className="text-sm">{p.rationale}</p>}
                <pre className="text-xs bg-gray-50 border rounded p-2 overflow-auto">
                  {JSON.stringify(p.candidate_selector, null, 2)}
                </pre>
                <DecisionForm
                  proposalId={p.id}
                  awaitingApproval={p.status === 'awaiting_approval'}
                />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
