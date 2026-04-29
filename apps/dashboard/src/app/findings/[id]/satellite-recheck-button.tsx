'use client';

import { useState, useTransition } from 'react';

interface Props {
  readonly findingId: string;
  readonly locale: string;
}

const COPY = {
  fr: {
    label: 'Lancer la vérification satellite',
    pending: 'Envoi…',
    queued: 'Demande mise en file (id: {id}). Mise à jour automatique.',
    deduplicated: 'Déjà en cours pour ce projet (id: {id}).',
    no_gps: 'Aucun événement avec GPS lié à ce constat.',
    error: 'Échec : ',
    description:
      'Demande à worker-satellite (NICFI → Sentinel-2 → Sentinel-1) une analyse d’activité sur l’AOI du projet.',
  },
  en: {
    label: 'Run satellite verification',
    pending: 'Submitting…',
    queued: 'Request queued (id: {id}). The result will appear automatically.',
    deduplicated: 'Already running for this project (id: {id}).',
    no_gps: 'No GPS-bearing event linked to this finding.',
    error: 'Failed: ',
    description:
      'Asks worker-satellite (NICFI → Sentinel-2 → Sentinel-1) to compute an activity score over the project AOI.',
  },
} as const;

export function SatelliteRecheckButton({ findingId, locale }: Props): JSX.Element {
  const lang: 'fr' | 'en' = locale === 'fr' ? 'fr' : 'en';
  const t = COPY[lang];
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'info' | 'success' | 'warn' | 'error'>('info');

  const submit = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/findings/${findingId}/satellite-recheck`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const data = (await res.json().catch(() => ({}))) as {
          requestId?: string;
          status?: string;
          deduplicated?: boolean;
          error?: string;
        };
        if (res.ok) {
          if (data.deduplicated) {
            setMessage(t.deduplicated.replace('{id}', data.requestId ?? '?'));
            setTone('warn');
          } else {
            setMessage(t.queued.replace('{id}', data.requestId ?? '?'));
            setTone('success');
          }
        } else if (data.error === 'no-gps-bearing-event-linked-to-finding') {
          setMessage(t.no_gps);
          setTone('warn');
        } else {
          setMessage(`${t.error}${data.error ?? `HTTP ${res.status}`}`);
          setTone('error');
        }
      } catch (err) {
        setMessage(`${t.error}${String(err)}`);
        setTone('error');
      }
    });
  };

  const toneClass =
    tone === 'success'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'error'
          ? 'text-red-700'
          : 'text-gray-700';

  return (
    <div className="border rounded p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t.label}</h3>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="px-3 py-1.5 rounded bg-sky-600 text-white disabled:opacity-50"
        >
          {pending ? t.pending : t.label}
        </button>
      </div>
      <p className="text-sm text-gray-600">{t.description}</p>
      {message && <p className={`text-sm ${toneClass}`}>{message}</p>}
    </div>
  );
}
