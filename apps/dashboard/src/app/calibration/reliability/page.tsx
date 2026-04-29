import { getLatestCalibrationView, type ReliabilityRow } from '../../../lib/certainty.server';
import { getLocale } from '../../../lib/i18n';

export const dynamic = 'force-dynamic';

const COPY = {
  fr: {
    title: 'Diagramme de fiabilité — Doctrine de sécurité IA',
    no_data: 'Aucun audit de calibration n’a encore été exécuté. La file de calibration trimestrielle s’écrit ici une fois clôturée.',
    period: 'Période',
    engine: 'Moteur',
    bands: 'Bandes de fiabilité',
    band: 'Bande',
    predicted: 'Prédit',
    observed: 'Observé',
    n: 'Constats',
    cleared: 'Innocentés',
    confirmed: 'Confirmés',
    gap: 'Écart',
    pattern_gaps: 'Écarts par motif (>5%)',
    anchor: 'Ancre Hyperledger',
    none: '—',
    flag: 'À recalibrer',
    legend:
      'Un écart absolu supérieur à 5 points de pourcentage déclenche la révision des rapports de vraisemblance pour les motifs concernés.',
  },
  en: {
    title: 'Reliability diagram — AI Safety Doctrine',
    no_data: 'No calibration audit has been run yet. The quarterly run writes here once signed off.',
    period: 'Period',
    engine: 'Engine',
    bands: 'Reliability bands',
    band: 'Band',
    predicted: 'Predicted',
    observed: 'Observed',
    n: 'Findings',
    cleared: 'Cleared',
    confirmed: 'Confirmed',
    gap: 'Gap',
    pattern_gaps: 'Per-pattern gaps (>5%)',
    anchor: 'Hyperledger anchor',
    none: '—',
    flag: 'recalibrate',
    legend:
      'An absolute gap above 5 percentage points triggers a likelihood-ratio review for the affected patterns.',
  },
} as const;

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function bandRowClass(gap: number): string {
  if (gap >= 0.1) return 'bg-red-50';
  if (gap >= 0.05) return 'bg-amber-50';
  return '';
}

function reliabilityChart(bands: ReadonlyArray<ReliabilityRow>): JSX.Element {
  // ASCII / SVG hybrid — predicted on x, observed on y, identity diagonal.
  const size = 320;
  const pad = 32;
  const inner = size - 2 * pad;
  const point = (v: number) => pad + v * inner;
  return (
    <svg width={size} height={size} role="img" aria-label="reliability diagram" className="border rounded">
      {/* axes */}
      <line x1={pad} y1={size - pad} x2={size - pad} y2={size - pad} stroke="#999" />
      <line x1={pad} y1={pad} x2={pad} y2={size - pad} stroke="#999" />
      {/* identity diagonal */}
      <line
        x1={pad}
        y1={size - pad}
        x2={size - pad}
        y2={pad}
        stroke="#94a3b8"
        strokeDasharray="4 3"
      />
      {/* bands */}
      {bands.map((b) => {
        const cx = point((b.bandMin + b.bandMax) / 2);
        const cy = size - pad - (b.observedRate * inner);
        const r = Math.max(3, Math.min(8, Math.sqrt(b.findingCount)));
        const tone = b.calibrationGap >= 0.1 ? '#dc2626' : b.calibrationGap >= 0.05 ? '#f59e0b' : '#10b981';
        return (
          <g key={b.bandLabel}>
            <circle cx={cx} cy={cy} r={r} fill={tone} opacity={0.85} />
            <text x={cx + r + 2} y={cy + 4} fontSize="10" fill="#334155">
              {b.bandLabel}
            </text>
          </g>
        );
      })}
      {/* axis labels */}
      <text x={size / 2} y={size - 6} textAnchor="middle" fontSize="11" fill="#475569">
        predicted
      </text>
      <text
        x={10}
        y={size / 2}
        textAnchor="middle"
        fontSize="11"
        fill="#475569"
        transform={`rotate(-90 10 ${size / 2})`}
      >
        observed
      </text>
    </svg>
  );
}

export default async function CalibrationReliabilityPage(): Promise<JSX.Element> {
  const view = await getLatestCalibrationView();
  const locale = getLocale();
  const lang: 'fr' | 'en' = locale === 'fr' ? 'fr' : 'en';
  const t = COPY[lang];

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
      </header>

      {!view ? (
        <p className="text-gray-600 italic">{t.no_data}</p>
      ) : (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4 border rounded p-4">
            <dl>
              <dt className="text-xs uppercase text-gray-500">{t.period}</dt>
              <dd className="font-mono">{view.periodLabel}</dd>
            </dl>
            <dl>
              <dt className="text-xs uppercase text-gray-500">{t.engine}</dt>
              <dd className="font-mono">{view.engineVersion}</dd>
            </dl>
            <dl className="md:col-span-2">
              <dt className="text-xs uppercase text-gray-500">{t.anchor}</dt>
              <dd className="font-mono break-all text-xs">
                {view.anchorAuditEventId ?? t.none}
              </dd>
            </dl>
          </section>

          <section aria-labelledby="reliability-chart" className="space-y-2">
            <h2 id="reliability-chart" className="text-xl font-semibold">
              {t.bands}
            </h2>
            <div className="flex flex-col md:flex-row gap-6 items-start">
              {reliabilityChart(view.bands)}
              <table className="w-full text-sm border rounded">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">{t.band}</th>
                    <th className="text-right p-2">{t.predicted}</th>
                    <th className="text-right p-2">{t.observed}</th>
                    <th className="text-right p-2">{t.n}</th>
                    <th className="text-right p-2">{t.cleared}</th>
                    <th className="text-right p-2">{t.confirmed}</th>
                    <th className="text-right p-2">{t.gap}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.bands.map((b) => (
                    <tr key={b.bandLabel} className={`border-t ${bandRowClass(b.calibrationGap)}`}>
                      <td className="p-2 font-mono">{b.bandLabel}</td>
                      <td className="p-2 text-right tabular-nums">{pct(b.predictedRate)}</td>
                      <td className="p-2 text-right tabular-nums">{pct(b.observedRate)}</td>
                      <td className="p-2 text-right tabular-nums">{b.findingCount}</td>
                      <td className="p-2 text-right tabular-nums">{b.clearedCount}</td>
                      <td className="p-2 text-right tabular-nums">{b.confirmedCount}</td>
                      <td className="p-2 text-right tabular-nums">{pct(b.calibrationGap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-600">{t.legend}</p>
          </section>

          {view.perPatternGap.length > 0 && (
            <section aria-labelledby="pattern-gaps">
              <h2 id="pattern-gaps" className="text-xl font-semibold mb-2">
                {t.pattern_gaps}
              </h2>
              <ul className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                {view.perPatternGap
                  .filter((p) => p.gap >= 0.05)
                  .sort((a, b) => b.gap - a.gap)
                  .map((p) => (
                    <li key={p.patternId} className="border rounded p-2 flex items-baseline gap-2">
                      <span className="font-mono">{p.patternId}</span>
                      <span className="ml-auto tabular-nums">{pct(p.gap)}</span>
                      <span className="text-xs uppercase text-amber-700">{t.flag}</span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
