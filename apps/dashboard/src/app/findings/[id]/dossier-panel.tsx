'use client';

import { useMemo, useState, useTransition } from 'react';

const RECIPIENT_BODIES = [
  'CONAC',
  'COUR_DES_COMPTES',
  'MINFI',
  'ANIF',
  'CDC',
  'OTHER',
] as const;

type RecipientBody = (typeof RECIPIENT_BODIES)[number];

interface DossierRow {
  readonly id: string;
  readonly ref: string;
  readonly language: string;
  readonly status: string;
  readonly pdf_cid: string | null;
  readonly rendered_at: string;
  readonly delivered_at: string | null;
  readonly acknowledged_at: string | null;
  readonly recipient_body_name: string;
}

interface RoutingDecisionRow {
  readonly id: string;
  readonly recipient_body_name: string;
  readonly source: string;
  readonly decided_by: string;
  readonly decided_at: string;
  readonly rationale: string;
}

interface Props {
  readonly findingId: string;
  readonly dossiers: ReadonlyArray<DossierRow>;
  readonly recommendedRecipientBody: string | null;
  readonly routingDecisions: ReadonlyArray<RoutingDecisionRow>;
  readonly locale: string;
}

const COPY = {
  fr: {
    heading: 'Dossier',
    download_fr: 'Télécharger PDF (FR)',
    download_en: 'Télécharger PDF (EN)',
    recipient: 'Destinataire',
    recommended: 'Recommandation auto',
    status: 'Statut',
    no_dossier: 'Aucun dossier généré pour ce constat.',
    change_body: 'Changer le destinataire',
    rationale_label: 'Motif (obligatoire)',
    rationale_min: 'Minimum 8 caractères.',
    submit: 'Confirmer le changement',
    cancel: 'Annuler',
    history: 'Historique des décisions de routage',
    body_change_succeeded: 'Destinataire modifié.',
    body_change_failed: 'Échec du changement de destinataire.',
    not_yet_signed: 'Le dossier n’est pas encore signé ; téléchargement non disponible.',
  },
  en: {
    heading: 'Dossier',
    download_fr: 'Download PDF (FR)',
    download_en: 'Download PDF (EN)',
    recipient: 'Recipient',
    recommended: 'Auto-recommendation',
    status: 'Status',
    no_dossier: 'No dossier rendered for this finding yet.',
    change_body: 'Change recipient body',
    rationale_label: 'Rationale (required)',
    rationale_min: 'Minimum 8 characters.',
    submit: 'Confirm change',
    cancel: 'Cancel',
    history: 'Routing decision history',
    body_change_succeeded: 'Recipient changed.',
    body_change_failed: 'Recipient change failed.',
    not_yet_signed: 'Dossier is not yet signed; download is unavailable.',
  },
} as const;

const DOWNLOAD_ALLOWED_STATUSES = new Set(['signed', 'pinned', 'delivered', 'acknowledged']);

function StatusBadge({ status }: { status: string }): JSX.Element {
  const tone =
    status === 'acknowledged'
      ? 'bg-emerald-100 text-emerald-900'
      : status === 'delivered'
        ? 'bg-sky-100 text-sky-900'
        : status === 'signed' || status === 'pinned'
          ? 'bg-amber-100 text-amber-900'
          : status === 'failed'
            ? 'bg-red-100 text-red-900'
            : 'bg-gray-100 text-gray-900';
  return (
    <span className={`inline-block text-xs uppercase px-2 py-0.5 rounded ${tone}`}>{status}</span>
  );
}

export function DossierPanel(props: Props): JSX.Element {
  const lang: 'fr' | 'en' = props.locale === 'fr' ? 'fr' : 'en';
  const t = COPY[lang];

  const fr = props.dossiers.find((d) => d.language === 'fr');
  const en = props.dossiers.find((d) => d.language === 'en');
  // Prefer the FR dossier's recipient body for display (both should agree
  // since they share the routing-decision source). Fall back to recommended.
  const currentRecipient =
    fr?.recipient_body_name ??
    en?.recipient_body_name ??
    props.recommendedRecipientBody ??
    null;

  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState<RecipientBody>(
    (currentRecipient as RecipientBody) ?? 'CONAC',
  );
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    if (rationale.trim().length < 8) {
      setError(t.rationale_min);
      return;
    }
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/findings/${props.findingId}/recipient-body`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient_body_name: body, rationale: rationale.trim() }),
        });
        if (!res.ok) {
          setError(`${t.body_change_failed} (HTTP ${res.status})`);
          return;
        }
        setSuccess(t.body_change_succeeded);
        setEditing(false);
        setRationale('');
        // Refresh server-rendered detail
        if (typeof window !== 'undefined') window.location.reload();
      } catch (err) {
        setError(`${t.body_change_failed}: ${String(err)}`);
      }
    });
  };

  const downloadHref = (langKey: 'fr' | 'en'): string | null => {
    const row = langKey === 'fr' ? fr : en;
    if (!row) return null;
    if (!DOWNLOAD_ALLOWED_STATUSES.has(row.status)) return null;
    return `/api/dossier/${row.ref}?lang=${langKey}`;
  };

  const sortedDecisions = useMemo(
    () =>
      [...props.routingDecisions].sort(
        (a, b) => new Date(b.decided_at).getTime() - new Date(a.decided_at).getTime(),
      ),
    [props.routingDecisions],
  );

  if (props.dossiers.length === 0) {
    return (
      <section aria-labelledby="finding-dossier">
        <h2 id="finding-dossier" className="text-xl font-semibold mb-2">
          {t.heading}
        </h2>
        <p className="text-gray-500">{t.no_dossier}</p>
        {props.recommendedRecipientBody && (
          <p className="text-sm text-gray-600 mt-1">
            {t.recommended}: <span className="font-mono">{props.recommendedRecipientBody}</span>
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="finding-dossier" className="space-y-3">
      <h2 id="finding-dossier" className="text-xl font-semibold">
        {t.heading}
      </h2>

      <div className="border rounded p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase text-gray-500">{t.recipient}</div>
          <div className="font-mono text-lg">{currentRecipient ?? '—'}</div>
          {props.recommendedRecipientBody &&
            props.recommendedRecipientBody !== currentRecipient && (
              <div className="text-xs text-gray-500 mt-1">
                {t.recommended}: {props.recommendedRecipientBody}
              </div>
            )}
        </div>
        <div className="flex items-start justify-end gap-2">
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-sm px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200"
            >
              {t.change_body}
            </button>
          )}
        </div>

        {editing && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="md:col-span-2 border-t pt-3 space-y-3"
          >
            <label className="block">
              <span className="text-sm font-medium">{t.recipient}</span>
              <select
                value={body}
                onChange={(e) => setBody(e.target.value as RecipientBody)}
                className="mt-1 block w-full rounded border-gray-300"
              >
                {RECIPIENT_BODIES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">{t.rationale_label}</span>
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                minLength={8}
                rows={3}
                className="mt-1 block w-full rounded border-gray-300 font-mono text-sm"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pending || rationale.trim().length < 8}
                className="px-3 py-1.5 rounded bg-sky-600 text-white disabled:opacity-50"
              >
                {t.submit}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                className="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200"
              >
                {t.cancel}
              </button>
            </div>
            {error && <p className="text-sm text-red-700">{error}</p>}
            {success && <p className="text-sm text-emerald-700">{success}</p>}
          </form>
        )}
      </div>

      <ul className="divide-y border rounded">
        {props.dossiers.map((d) => {
          const href = downloadHref(d.language as 'fr' | 'en');
          return (
            <li key={d.id} className="px-4 py-2 flex items-baseline gap-3">
              <span className="font-mono">{d.ref}</span>
              <span className="text-xs uppercase font-bold">{d.language}</span>
              <StatusBadge status={d.status} />
              <span className="text-xs uppercase text-gray-500">{d.recipient_body_name}</span>
              {href ? (
                <a
                  href={href}
                  className="ml-auto text-sm text-sky-700 hover:underline"
                  download
                >
                  {d.language === 'fr' ? t.download_fr : t.download_en}
                </a>
              ) : (
                <span className="ml-auto text-xs text-gray-500">{t.not_yet_signed}</span>
              )}
            </li>
          );
        })}
      </ul>

      {sortedDecisions.length > 0 && (
        <details className="border rounded p-3">
          <summary className="text-sm font-medium cursor-pointer">{t.history}</summary>
          <ol className="mt-2 space-y-1 text-sm">
            {sortedDecisions.map((d) => (
              <li key={d.id} className="font-mono">
                <span className="tabular-nums">{new Date(d.decided_at).toLocaleString(props.locale)}</span>
                {' — '}
                <span>{d.recipient_body_name}</span>
                {' '}
                <span className="text-xs uppercase text-gray-500">{d.source}</span>
                {' '}
                <span className="text-xs text-gray-500">by {d.decided_by}</span>
                <div className="text-xs text-gray-700 ml-4 italic">{d.rationale}</div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
