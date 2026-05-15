import type { OutcomeView } from '../../../lib/dossier-outcome.server';

const COPY = {
  fr: {
    title: 'Suites institutionnelles — boucle de retour Layer-7',
    description:
      'Signaux opérationnels externes (presse CONAC, Cour Suprême, débarment ARMP, bulletin ANIF, clawback MINFI) corrélés au(x) dossier(s) délivré(s) pour cette constatation. Source : worker-outcome-feedback, table dossier.dossier_outcome.',
    empty: 'Aucune suite institutionnelle observée pour le moment.',
    source_label: 'Source',
    kind_label: 'Type',
    score: 'Confiance',
    matched_at: 'Mise en correspondance',
    rationale: 'Justification',
    signal_date: 'Date du signal',
    dossier_ref: 'Dossier',
    sources: {
      conac_press: 'Communiqué CONAC',
      cour_supreme: 'Cour Suprême',
      armp_debarment: 'Débarment ARMP',
      tpi_court_roll: 'Rôle TPI',
      anif_bulletin: 'Bulletin ANIF',
      minfi_clawback: 'Clawback MINFI',
    } as Readonly<Record<string, string>>,
    kinds: {
      investigation_opened: 'Enquête ouverte',
      charges_filed: 'Mise en accusation',
      conviction: 'Condamnation',
      acquittal: 'Acquittement',
      debarment: 'Exclusion',
      fine_assessed: 'Amende prononcée',
      asset_freeze: 'Gel des avoirs',
      asset_clawback: 'Récupération des avoirs',
      case_closed_without_action: 'Classement sans suite',
    } as Readonly<Record<string, string>>,
  },
  en: {
    title: 'Institutional outcomes — Layer-7 feedback loop',
    description:
      'External operational signals (CONAC press, Cour Suprême, ARMP debarment, ANIF bulletin, MINFI clawback) matched against the dossier(s) delivered for this finding. Source: worker-outcome-feedback writing to dossier.dossier_outcome.',
    empty: 'No institutional outcomes observed yet.',
    source_label: 'Source',
    kind_label: 'Kind',
    score: 'Confidence',
    matched_at: 'Matched',
    rationale: 'Rationale',
    signal_date: 'Signal date',
    dossier_ref: 'Dossier',
    sources: {
      conac_press: 'CONAC press release',
      cour_supreme: 'Cour Suprême',
      armp_debarment: 'ARMP debarment',
      tpi_court_roll: 'TPI court roll',
      anif_bulletin: 'ANIF bulletin',
      minfi_clawback: 'MINFI clawback',
    } as Readonly<Record<string, string>>,
    kinds: {
      investigation_opened: 'Investigation opened',
      charges_filed: 'Charges filed',
      conviction: 'Conviction',
      acquittal: 'Acquittal',
      debarment: 'Debarment',
      fine_assessed: 'Fine assessed',
      asset_freeze: 'Asset freeze',
      asset_clawback: 'Asset clawback',
      case_closed_without_action: 'Closed without action',
    } as Readonly<Record<string, string>>,
  },
} as const;

function scoreTone(s: number): string {
  if (s >= 0.85) return 'bg-emerald-50 border-emerald-300 text-emerald-900';
  if (s >= 0.7) return 'bg-sky-50 border-sky-300 text-sky-900';
  return 'bg-slate-50 border-slate-300 text-slate-900';
}

interface OutcomePanelProps {
  readonly outcomes: ReadonlyArray<OutcomeView>;
  readonly locale: 'fr' | 'en';
}

export function OutcomePanel({ outcomes, locale }: OutcomePanelProps): JSX.Element {
  const t = COPY[locale];
  return (
    <section aria-labelledby="finding-outcomes" className="space-y-3">
      <header>
        <h2 id="finding-outcomes" className="text-xl font-semibold">
          {t.title}
        </h2>
        <p className="text-sm text-gray-600">{t.description}</p>
      </header>
      {outcomes.length === 0 ? (
        <p className="text-sm text-gray-500 italic">{t.empty}</p>
      ) : (
        <ul className="space-y-3">
          {outcomes.map((o) => {
            const sourceLabel = t.sources[o.signal_source] ?? o.signal_source;
            const kindLabel = t.kinds[o.signal_kind] ?? o.signal_kind;
            return (
              <li
                key={o.id}
                className={`border-2 rounded p-3 space-y-2 ${scoreTone(o.match_score)}`}
              >
                <div className="flex items-baseline justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-xs uppercase tracking-wide font-semibold">
                      {sourceLabel}
                    </span>
                    <span className="mx-2 text-gray-400">·</span>
                    <span className="text-xs font-medium">{kindLabel}</span>
                  </div>
                  <span className="text-xs tabular-nums">
                    {t.score}: {(o.match_score * 100).toFixed(0)}%
                  </span>
                </div>

                <div className="text-xs text-gray-700">
                  <span className="text-gray-500">{t.dossier_ref}:</span>{' '}
                  <code className="font-mono">{o.dossier_ref}</code>
                  <span className="mx-2 text-gray-400">·</span>
                  <span className="text-gray-500">{t.signal_date}:</span>{' '}
                  {new Date(o.signal_date).toISOString().slice(0, 10)}
                </div>

                <p className="text-xs font-mono whitespace-pre-wrap">{o.rationale}</p>

                <div className="text-[10px] text-gray-500 grid grid-cols-4 gap-2 pt-1 border-t border-current/20">
                  <div>entity {(o.entity_overlap * 100).toFixed(0)}%</div>
                  <div>temporal {(o.temporal_proximity * 100).toFixed(0)}%</div>
                  <div>body {(o.body_alignment * 100).toFixed(0)}%</div>
                  <div>category {(o.category_alignment * 100).toFixed(0)}%</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
