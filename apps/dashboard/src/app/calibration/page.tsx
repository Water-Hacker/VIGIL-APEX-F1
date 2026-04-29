import { getLocale, loadMessages, t } from '../../lib/i18n';
import { getCalibrationView } from '../../lib/calibration.server';

import { RunNowButton } from './run-now';

export const dynamic = 'force-dynamic';

function eceTone(v: number): string {
  if (v <= 0.05) return 'text-emerald-700';
  if (v <= 0.10) return 'text-amber-700';
  return 'text-red-700';
}

export default async function CalibrationPage(): Promise<JSX.Element> {
  const locale = getLocale();
  const messages = await loadMessages(locale);
  const view = await getCalibrationView();

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{t(messages, 'calibration.title')}</h1>
        <RunNowButton label={t(messages, 'calibration.run_now')} />
      </header>

      {view.latest === null ? (
        <p className="text-gray-500">No calibration report yet.</p>
      ) : (
        <>
          <section
            aria-labelledby="latest"
            className="grid grid-cols-2 md:grid-cols-4 gap-4 border rounded p-4"
          >
            <h2 id="latest" className="sr-only">
              Latest report
            </h2>
            <dl>
              <dt className="text-xs uppercase text-gray-500">{t(messages, 'calibration.ece_overall')}</dt>
              <dd className={`text-2xl font-semibold tabular-nums ${eceTone(view.latest.ece_overall)}`}>
                {(view.latest.ece_overall * 100).toFixed(1)}%
              </dd>
            </dl>
            <dl>
              <dt className="text-xs uppercase text-gray-500">Brier</dt>
              <dd className="text-2xl font-semibold tabular-nums">{view.latest.brier_overall.toFixed(3)}</dd>
            </dl>
            <dl>
              <dt className="text-xs uppercase text-gray-500">Window</dt>
              <dd className="text-2xl font-semibold tabular-nums">{view.latest.window_days}d</dd>
            </dl>
            <dl>
              <dt className="text-xs uppercase text-gray-500">Graded / total</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {view.latest.graded_entries} / {view.latest.total_entries}
              </dd>
            </dl>
          </section>

          <section aria-labelledby="per-pattern">
            <h2 id="per-pattern" className="text-xl font-semibold mb-2">
              Per pattern
            </h2>
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500 border-b">
                <tr>
                  <th className="px-2 py-1">pattern</th>
                  <th className="px-2 py-1 text-right">N</th>
                  <th className="px-2 py-1 text-right">ECE</th>
                  <th className="px-2 py-1 text-right">hit-rate</th>
                </tr>
              </thead>
              <tbody>
                {view.latest.per_pattern.map((p) => (
                  <tr key={p.pattern_id} className="border-b last:border-0">
                    <td className="px-2 py-1 font-mono text-xs">{p.pattern_id}</td>
                    <td className="px-2 py-1 tabular-nums text-right">{p.n}</td>
                    <td className={`px-2 py-1 tabular-nums text-right ${eceTone(p.ece)}`}>
                      {(p.ece * 100).toFixed(1)}%
                    </td>
                    <td className="px-2 py-1 tabular-nums text-right">{(p.hit_rate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="recent">
            <h2 id="recent" className="text-xl font-semibold mb-2">
              Recent ECE
            </h2>
            <ul className="text-sm tabular-nums">
              {view.recent.map((r) => (
                <li key={r.computed_at} className="flex justify-between border-b py-1">
                  <span>{r.computed_at}</span>
                  <span className={eceTone(r.ece_overall)}>{(r.ece_overall * 100).toFixed(2)}%</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
