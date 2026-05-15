import { getLocale } from '../../../lib/i18n';
import { listAwaitingCuration } from '../../../lib/pattern-discovery.server';

export const dynamic = 'force-dynamic';

const COPY = {
  fr: {
    title: 'File de curation — découverte de motifs',
    description:
      "Anomalies graphiques détectées par worker-pattern-discovery, en attente de curation architecte/audit. Une décision « promu » déclenche la rédaction d'un nouveau pattern P-X-NNN ; « rejeté » archive sans action.",
    kind: 'Type',
    strength: 'Force',
    entities: 'Entités impliquées',
    first_seen: 'Première observation',
    last_seen: 'Dernière observation',
    rationale: 'Justification',
    actions: 'Actions',
    promote: 'Promouvoir',
    dismiss: 'Rejeter',
    merge: 'Fusionner',
    empty: 'Aucune anomalie en attente de curation.',
    counter: 'En attente : ',
  },
  en: {
    title: 'Curation queue — pattern discovery',
    description:
      'Graph anomalies detected by worker-pattern-discovery awaiting architect/auditor curation. A "promote" decision triggers authoring a new P-X-NNN pattern; "dismiss" archives without action.',
    kind: 'Kind',
    strength: 'Strength',
    entities: 'Entities involved',
    first_seen: 'First seen',
    last_seen: 'Last seen',
    rationale: 'Rationale',
    actions: 'Actions',
    promote: 'Promote',
    dismiss: 'Dismiss',
    merge: 'Merge',
    empty: 'No anomalies awaiting curation.',
    counter: 'Awaiting: ',
  },
} as const;

const KIND_LABELS: Readonly<Record<string, { fr: string; en: string }>> = {
  stellar_degree: {
    fr: 'Degré stellaire',
    en: 'Stellar degree',
  },
  tight_community_outflow: {
    fr: 'Sortie communautaire concentrée',
    en: 'Tight-community outflow',
  },
  cycle_3_to_6: {
    fr: 'Cycle de paiement (3–6 nœuds)',
    en: 'Payment cycle (3–6 nodes)',
  },
  sudden_mass_creation: {
    fr: 'Création massive soudaine',
    en: 'Sudden mass creation',
  },
  burst_then_quiet: {
    fr: 'Salve puis silence',
    en: 'Burst then quiet',
  },
  triangle_bridge: {
    fr: 'Pont triangulaire',
    en: 'Triangle bridge',
  },
};

function strengthTone(s: number): string {
  if (s >= 0.85) return 'bg-red-50 border-red-300 text-red-900';
  if (s >= 0.6) return 'bg-amber-50 border-amber-300 text-amber-900';
  return 'bg-slate-50 border-slate-300 text-slate-900';
}

export default async function DiscoveryQueuePage(): Promise<JSX.Element> {
  const candidates = await listAwaitingCuration(50);
  const locale = getLocale();
  const lang: 'fr' | 'en' = locale === 'fr' ? 'fr' : 'en';
  const t = COPY[lang];

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-sm text-gray-600">{t.description}</p>
        <p className="text-xs text-gray-500 mt-2">
          {t.counter}
          <span className="font-mono tabular-nums font-semibold">{candidates.length}</span>
        </p>
      </header>

      {candidates.length === 0 ? (
        <p className="text-sm text-gray-500 italic">{t.empty}</p>
      ) : (
        <ul className="space-y-4">
          {candidates.map((c) => {
            const kindLabel = KIND_LABELS[c.kind]?.[lang] ?? c.kind;
            return (
              <li
                key={c.id}
                className={`border-2 rounded p-4 space-y-3 ${strengthTone(c.strength)}`}
              >
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-xs uppercase font-semibold tracking-wide">
                      {t.kind}: {kindLabel}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      <code className="font-mono">{c.id}</code>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs uppercase">{t.strength}</div>
                    <div className="text-2xl font-mono tabular-nums font-bold">
                      {c.strength.toFixed(3)}
                    </div>
                  </div>
                </div>

                <div className="text-sm">
                  <div className="text-xs uppercase text-gray-500">{t.rationale}</div>
                  <p className="font-mono text-xs whitespace-pre-wrap">{c.rationale}</p>
                </div>

                <div className="text-sm">
                  <div className="text-xs uppercase text-gray-500">{t.entities}</div>
                  <ul className="font-mono text-xs space-y-0.5 mt-1">
                    {c.entity_ids_involved.slice(0, 8).map((id) => (
                      <li key={id}>{id}</li>
                    ))}
                    {c.entity_ids_involved.length > 8 ? (
                      <li className="text-gray-500">+{c.entity_ids_involved.length - 8}…</li>
                    ) : null}
                  </ul>
                </div>

                <div className="flex items-baseline justify-between text-xs text-gray-600">
                  <span>
                    {t.first_seen}: {new Date(c.first_seen_at).toISOString().slice(0, 10)}
                  </span>
                  <span>
                    {t.last_seen}: {new Date(c.last_seen_at).toISOString().slice(0, 10)}
                  </span>
                </div>

                <form
                  action="/api/audit/discovery-queue/curate"
                  method="POST"
                  className="flex gap-2 pt-2 border-t border-current/20"
                >
                  <input type="hidden" name="id" value={c.id} />
                  <button
                    type="submit"
                    name="decision"
                    value="promoted"
                    className="text-xs px-3 py-1 rounded bg-emerald-700 text-white hover:bg-emerald-800"
                  >
                    {t.promote}
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="dismissed"
                    className="text-xs px-3 py-1 rounded bg-slate-700 text-white hover:bg-slate-800"
                  >
                    {t.dismiss}
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="merged"
                    className="text-xs px-3 py-1 rounded bg-sky-700 text-white hover:bg-sky-800"
                  >
                    {t.merge}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
