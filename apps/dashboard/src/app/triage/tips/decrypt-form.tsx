'use client';

import { useState } from 'react';

interface Labels {
  shares: string; // contains "{count}"
  decrypt: string;
  promote: string;
  cancel: string;
}

/**
 * Tip-quorum decrypt UI (Phase C10). Three council members each paste
 * their base64-encoded Shamir share. The page POSTs to
 * /api/triage/tips/decrypt with all three; the server-side worker
 * (worker-tip-triage) reconstructs the operator-team key, decrypts,
 * and returns the paraphrased text — never the verbatim plaintext, per
 * SRD §28.4.
 *
 * The shares never persist client-side; on submit we clear them.
 */
export function TipDecryptForm({
  tipId,
  labels,
}: {
  tipId: string;
  labels: Labels;
}): JSX.Element {
  const [shares, setShares] = useState<string[]>(['', '', '']);
  const [paraphrase, setParaphrase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const collected = shares.filter((s) => s.trim().length > 0).length;

  async function decrypt(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/triage/tips/decrypt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tip_id: tipId, decryption_shares: shares }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(typeof j.error === 'string' ? j.error : `http ${r.status}`);
      }
      const j = await r.json();
      setParaphrase(typeof j.paraphrase === 'string' ? j.paraphrase : '');
      // Clear shares from memory immediately on success.
      setShares(['', '', '']);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown');
    } finally {
      setBusy(false);
    }
  }

  if (paraphrase !== null) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm uppercase text-gray-500">Paraphrase</h3>
        <pre className="whitespace-pre-wrap border rounded bg-gray-50 p-3 text-sm">{paraphrase}</pre>
        <button
          type="button"
          className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm"
          onClick={async () => {
            await fetch(`/api/triage/tips/promote`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ tip_id: tipId }),
            });
            window.location.reload();
          }}
        >
          {labels.promote}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">{labels.shares.replace('{count}', String(collected))}</p>
      {shares.map((s, i) => (
        <input
          key={i}
          type="password"
          className="block w-full border rounded p-2 font-mono text-xs"
          aria-label={`share ${i + 1}`}
          placeholder={`share ${i + 1}`}
          value={s}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            const next = [...shares];
            next[i] = e.target.value;
            setShares(next);
          }}
        />
      ))}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || collected < 3}
          onClick={decrypt}
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:bg-gray-300"
        >
          {labels.decrypt}
        </button>
      </div>
      {err && (
        <p role="alert" className="text-sm text-red-700">
          {err}
        </p>
      )}
    </div>
  );
}
