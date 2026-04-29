import { getAiSafetyHealth } from '../../../lib/certainty.server';
import { getLocale } from '../../../lib/i18n';

export const dynamic = 'force-dynamic';

const COPY = {
  fr: {
    title: 'Tableau de bord sécurité IA — 24 dernières heures',
    description:
      'Indicateurs en direct des défenses contre les modes d’échec des LLM (AI-SAFETY-DOCTRINE-v1, partie B). Toute valeur en rouge déclenche une revue manuelle.',
    total_calls: 'Appels Claude (24h)',
    canary: 'Canaris déclenchés',
    schema_invalid: 'Sorties non conformes au schéma',
    verbatim_sampled: 'Échantillons textuels vérifiés',
    hallucination: 'Taux d’hallucination',
    target: 'Cible : <0,5%',
    healthy: 'Conforme',
    warn: 'À surveiller',
    crit: 'Critique',
    legend:
      'Le canari est une phrase quotidienne que Claude doit ne jamais répéter ; sa présence dans la sortie indique une injection de prompt réussie.',
  },
  en: {
    title: 'AI Safety dashboard — last 24 hours',
    description:
      'Live indicators of the LLM-failure-mode defences (AI-SAFETY-DOCTRINE-v1 Part B). Any red value triggers a manual review.',
    total_calls: 'Claude calls (24h)',
    canary: 'Canary triggers',
    schema_invalid: 'Schema-invalid outputs',
    verbatim_sampled: 'Verbatim audit samples',
    hallucination: 'Hallucination rate',
    target: 'Target: <0.5%',
    healthy: 'Healthy',
    warn: 'Watch',
    crit: 'Critical',
    legend:
      "The canary is a daily-rotated phrase Claude is told never to repeat; its presence in any output signals a successful prompt injection.",
  },
} as const;

function tone(rate: number, warn: number, crit: number): string {
  if (rate >= crit) return 'bg-red-50 border-red-300 text-red-900';
  if (rate >= warn) return 'bg-amber-50 border-amber-300 text-amber-900';
  return 'bg-emerald-50 border-emerald-300 text-emerald-900';
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

export default async function AiSafetyDashboardPage(): Promise<JSX.Element> {
  const health = await getAiSafetyHealth(24);
  const locale = getLocale();
  const lang: 'fr' | 'en' = locale === 'fr' ? 'fr' : 'en';
  const t = COPY[lang];

  const canaryRate = health.totalCalls === 0 ? 0 : health.canaryTriggered / health.totalCalls;
  const schemaRate = health.totalCalls === 0 ? 0 : health.schemaInvalid / health.totalCalls;
  const labelTone = (r: number, w: number, c: number): string => {
    if (r >= c) return t.crit;
    if (r >= w) return t.warn;
    return t.healthy;
  };

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-sm text-gray-600">{t.description}</p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded p-4">
          <div className="text-xs uppercase text-gray-500">{t.total_calls}</div>
          <div className="text-3xl font-mono tabular-nums">{health.totalCalls}</div>
        </div>

        <div className={`border-2 rounded p-4 ${tone(canaryRate, 0.0001, 0.001)}`}>
          <div className="flex items-baseline justify-between">
            <div className="text-xs uppercase">{t.canary}</div>
            <span className="text-xs uppercase font-bold">
              {labelTone(canaryRate, 0.0001, 0.001)}
            </span>
          </div>
          <div className="text-3xl font-mono tabular-nums">{health.canaryTriggered}</div>
          <p className="text-xs">{t.legend}</p>
        </div>

        <div className={`border-2 rounded p-4 ${tone(schemaRate, 0.001, 0.01)}`}>
          <div className="flex items-baseline justify-between">
            <div className="text-xs uppercase">{t.schema_invalid}</div>
            <span className="text-xs uppercase font-bold">
              {labelTone(schemaRate, 0.001, 0.01)}
            </span>
          </div>
          <div className="text-3xl font-mono tabular-nums">{health.schemaInvalid}</div>
        </div>

        <div className={`border-2 rounded p-4 ${tone(health.hallucinationRate, 0.005, 0.02)}`}>
          <div className="flex items-baseline justify-between">
            <div className="text-xs uppercase">{t.hallucination}</div>
            <span className="text-xs uppercase font-bold">
              {labelTone(health.hallucinationRate, 0.005, 0.02)}
            </span>
          </div>
          <div className="text-3xl font-mono tabular-nums">{pct(health.hallucinationRate)}</div>
          <div className="text-xs">{t.target}</div>
          <div className="text-xs text-gray-600">
            {t.verbatim_sampled}: {health.verbatimSampled}
          </div>
        </div>
      </section>
    </main>
  );
}
