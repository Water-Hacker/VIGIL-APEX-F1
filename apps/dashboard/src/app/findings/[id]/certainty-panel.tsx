import type { AssessmentSummary } from '../../../lib/certainty.server';

interface Props {
  readonly locale: string;
  readonly assessment: AssessmentSummary | null;
}

const COPY = {
  fr: {
    title: 'Évaluation de la certitude — Doctrine de sécurité IA',
    no_assessment: 'Aucune évaluation enregistrée pour ce constat.',
    prior: 'Probabilité a priori',
    posterior: 'Posterior bayésien',
    sources: 'Sources indépendantes',
    tier: 'File de routage',
    engine: 'Moteur',
    model: 'Modèle (épinglé)',
    input_hash: 'Empreinte des entrées',
    prompt_hash: 'Empreinte du registre des prompts',
    computed_at: 'Calculé le',
    adversarial: 'Pipeline contradictoire',
    devil: 'Avocat du diable',
    counterfactual: 'Sonde contrefactuelle',
    order: 'Randomisation d’ordre',
    secondary: 'Revue indépendante',
    components: 'Composantes du score',
    pattern: 'Motif',
    source: 'Source',
    strength: 'Force',
    lr: 'Rapport de vraisemblance',
    weight: 'Poids effectif',
    roots: 'Racines de provenance',
    quote: 'Citation textuelle',
    rationale: 'Justification',
    holds: 'Motifs de retenue',
    none: 'Aucun',
    pass: 'Conforme',
    fail: 'À examiner',
    yes: 'Oui',
    no: 'Non',
    tier_action: 'File d’action (≥ 95 %, 5 sources)',
    tier_review: 'File d’investigation (80–94 %)',
    tier_log: 'Journalisé seulement (< 80 %)',
  },
  en: {
    title: 'Certainty assessment — AI Safety Doctrine',
    no_assessment: 'No assessment recorded for this finding yet.',
    prior: 'Prior probability',
    posterior: 'Bayesian posterior',
    sources: 'Independent sources',
    tier: 'Dispatch tier',
    engine: 'Engine version',
    model: 'Model (pinned)',
    input_hash: 'Input hash',
    prompt_hash: 'Prompt-registry hash',
    computed_at: 'Computed at',
    adversarial: 'Adversarial pipeline',
    devil: "Devil's advocate",
    counterfactual: 'Counterfactual probe',
    order: 'Order randomisation',
    secondary: 'Independent secondary review',
    components: 'Score components',
    pattern: 'Pattern',
    source: 'Source',
    strength: 'Strength',
    lr: 'Likelihood ratio',
    weight: 'Effective weight',
    roots: 'Provenance roots',
    quote: 'Verbatim quote',
    rationale: 'Rationale',
    holds: 'Hold reasons',
    none: 'None',
    pass: 'PASS',
    fail: 'HELD',
    yes: 'Yes',
    no: 'No',
    tier_action: 'Action queue (≥ 95 %, 5 sources)',
    tier_review: 'Investigation queue (80–94 %)',
    tier_log: 'Log only (< 80 %)',
  },
} as const;

function tierBadge(t: string, lang: 'fr' | 'en'): { label: string; tone: string } {
  const c = COPY[lang];
  if (t === 'action_queue') return { label: c.tier_action, tone: 'bg-red-100 text-red-900' };
  if (t === 'investigation_queue')
    return { label: c.tier_review, tone: 'bg-amber-100 text-amber-900' };
  return { label: c.tier_log, tone: 'bg-gray-100 text-gray-900' };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function CertaintyPanel(props: Props): JSX.Element {
  const lang: 'fr' | 'en' = props.locale === 'fr' ? 'fr' : 'en';
  const t = COPY[lang];
  if (!props.assessment) {
    return (
      <section aria-labelledby="finding-certainty">
        <h2 id="finding-certainty" className="text-xl font-semibold mb-2">
          {t.title}
        </h2>
        <p className="text-gray-500 italic">{t.no_assessment}</p>
      </section>
    );
  }
  const a = props.assessment;
  const tier = tierBadge(a.tier, lang);
  const adv = a.adversarial;
  return (
    <section aria-labelledby="finding-certainty" className="space-y-3">
      <h2 id="finding-certainty" className="text-xl font-semibold">
        {t.title}
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 border rounded p-4">
        <dl>
          <dt className="text-xs uppercase text-gray-500">{t.prior}</dt>
          <dd className="font-mono tabular-nums">{pct(a.priorProbability)}</dd>
        </dl>
        <dl>
          <dt className="text-xs uppercase text-gray-500">{t.posterior}</dt>
          <dd className="font-mono tabular-nums text-lg">{pct(a.posteriorProbability)}</dd>
        </dl>
        <dl>
          <dt className="text-xs uppercase text-gray-500">{t.sources}</dt>
          <dd className="font-mono tabular-nums">{a.independentSourceCount} / 5</dd>
        </dl>
        <dl>
          <dt className="text-xs uppercase text-gray-500">{t.tier}</dt>
          <dd>
            <span className={`inline-block text-xs px-2 py-0.5 rounded ${tier.tone}`}>
              {tier.label}
            </span>
          </dd>
        </dl>
      </div>

      <div className="border rounded p-4">
        <h3 className="font-semibold mb-2">{t.adversarial}</h3>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          <li>
            <span className="font-medium">{t.devil}:</span>{' '}
            <span className={adv.devilsAdvocateCoherent ? 'text-amber-700' : 'text-emerald-700'}>
              {adv.devilsAdvocateCoherent ? t.fail : t.pass}
            </span>
            {adv.devilsAdvocateSummary && (
              <p className="text-xs italic text-gray-600 mt-1">{adv.devilsAdvocateSummary}</p>
            )}
          </li>
          <li>
            <span className="font-medium">{t.counterfactual}:</span>{' '}
            <span className={adv.counterfactualRobust ? 'text-emerald-700' : 'text-amber-700'}>
              {adv.counterfactualRobust ? t.pass : t.fail}
            </span>
            <p className="text-xs text-gray-600">P sans la composante la plus forte / w/o strongest = {pct(adv.counterfactualPosterior)}</p>
          </li>
          <li>
            <span className="font-medium">{t.order}:</span>{' '}
            <span className={adv.orderRandomisationStable ? 'text-emerald-700' : 'text-amber-700'}>
              {adv.orderRandomisationStable ? t.pass : t.fail}
            </span>
            <p className="text-xs text-gray-600">
              min={pct(adv.orderRandomisationMin)} / max={pct(adv.orderRandomisationMax)}
            </p>
          </li>
          <li>
            <span className="font-medium">{t.secondary}:</span>{' '}
            <span className={adv.secondaryReviewAgreement ? 'text-emerald-700' : 'text-amber-700'}>
              {adv.secondaryReviewAgreement ? t.pass : t.fail}
            </span>
          </li>
        </ul>
      </div>

      <div className="border rounded p-4">
        <h3 className="font-semibold mb-2">{t.holds}</h3>
        {a.holdReasons.length === 0 ? (
          <p className="text-emerald-700 text-sm">{t.none}</p>
        ) : (
          <ul className="list-disc list-inside text-sm">
            {a.holdReasons.map((r) => (
              <li key={r} className="text-amber-800 font-mono">
                {r}
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="border rounded">
        <summary className="cursor-pointer px-4 py-2 font-semibold">{t.components}</summary>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t">
              <th className="text-left p-2">{t.pattern}</th>
              <th className="text-left p-2">{t.source}</th>
              <th className="text-right p-2">{t.strength}</th>
              <th className="text-right p-2">{t.lr}</th>
              <th className="text-right p-2">{t.weight}</th>
              <th className="text-left p-2">{t.roots}</th>
            </tr>
          </thead>
          <tbody>
            {a.components.map((c) => (
              <tr key={c.evidence_id} className="border-t align-top">
                <td className="p-2 font-mono">{c.pattern_id ?? '—'}</td>
                <td className="p-2 font-mono">{c.source_id ?? '—'}</td>
                <td className="p-2 text-right tabular-nums">{c.strength.toFixed(2)}</td>
                <td className="p-2 text-right tabular-nums">{c.likelihood_ratio.toFixed(2)}</td>
                <td className="p-2 text-right tabular-nums">{c.effective_weight.toFixed(2)}</td>
                <td className="p-2 font-mono text-xs">{c.provenance_roots.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <div className="border rounded p-4 text-xs text-gray-600 grid grid-cols-2 md:grid-cols-3 gap-2">
        <div>
          <span className="uppercase">{t.engine}</span>
          <div className="font-mono">{a.engineVersion}</div>
        </div>
        <div>
          <span className="uppercase">{t.model}</span>
          <div className="font-mono break-all">{a.modelVersion}</div>
        </div>
        <div>
          <span className="uppercase">{t.computed_at}</span>
          <div className="font-mono">{new Date(a.computedAt).toLocaleString(props.locale)}</div>
        </div>
        <div className="md:col-span-3">
          <span className="uppercase">{t.input_hash}</span>
          <div className="font-mono break-all">{a.inputHash}</div>
        </div>
        <div className="md:col-span-3">
          <span className="uppercase">{t.prompt_hash}</span>
          <div className="font-mono break-all">{a.promptRegistryHash}</div>
        </div>
      </div>
    </section>
  );
}
