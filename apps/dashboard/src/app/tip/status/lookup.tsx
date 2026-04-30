'use client';

import { useEffect, useState } from 'react';

interface Labels {
  dispositionLabel: string;
  receivedOnLabel: string;
  notFound: string;
  submit: string;
}

interface StatusResp {
  ref: string;
  disposition: string;
  received_on: string;
  body_ciphertext_sha256?: string;
  last_disposition_audit_event_id?: string | null;
  body_intact?: boolean;
}

interface LocalVerify {
  state: 'idle' | 'busy' | 'match' | 'mismatch' | 'error';
  detail?: string;
}

/**
 * Citizen receipt panel. Renders the disposition + the tamper-evident
 * fields (sha256 / audit-event / body_intact) the API now returns
 * (DECISION-016). The "verify locally" button accepts the citizen's
 * own copy of the encrypted blob (the file the browser saved at submit
 * time) and computes its SHA-256 in-browser via SubtleCrypto. Match
 * proves the system has not modified the tip; mismatch is a tamper
 * signal the citizen can take to a journalist or court.
 */
export function StatusLookup({
  initialRef,
  labels,
}: {
  initialRef: string;
  labels: Labels;
}): JSX.Element {
  const [ref, setRef] = useState(initialRef);
  const [data, setData] = useState<StatusResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState<LocalVerify>({ state: 'idle' });

  async function lookup(target: string): Promise<void> {
    setBusy(true);
    setError(null);
    setData(null);
    setVerify({ state: 'idle' });
    try {
      const r = await fetch(`/api/tip/status?ref=${encodeURIComponent(target)}`);
      if (r.status === 404) {
        setError(labels.notFound);
        return;
      }
      if (!r.ok) throw new Error(`http ${r.status}`);
      setData((await r.json()) as StatusResp);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown');
    } finally {
      setBusy(false);
    }
  }

  async function verifyLocally(file: File): Promise<void> {
    if (!data?.body_ciphertext_sha256) {
      setVerify({ state: 'error', detail: 'no server-side hash to compare' });
      return;
    }
    setVerify({ state: 'busy' });
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (hex === data.body_ciphertext_sha256) {
        setVerify({ state: 'match', detail: hex });
      } else {
        setVerify({
          state: 'mismatch',
          detail: `local=${hex} server=${data.body_ciphertext_sha256}`,
        });
      }
    } catch (e) {
      setVerify({ state: 'error', detail: e instanceof Error ? e.message : 'unknown' });
    }
  }

  useEffect(() => {
    if (initialRef) void lookup(initialRef);
  }, [initialRef]);

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(ref);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          aria-label="reference"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="TIP-2026-0001"
          className="flex-1 border rounded p-2 font-mono text-sm"
        />
        <button
          type="submit"
          disabled={busy || !ref}
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:bg-gray-300"
        >
          {labels.submit}
        </button>
      </form>

      {data && (
        <div className="border rounded p-4 space-y-3">
          <div>
            <span className="text-xs uppercase text-gray-500 mr-2">{labels.dispositionLabel}</span>
            <span className="font-mono">{data.disposition}</span>
          </div>
          <div className="text-sm text-gray-600">
            {labels.receivedOnLabel.replace('{date}', data.received_on)}
          </div>
          {data.body_intact === false && (
            <p className="text-sm text-amber-700" role="status">
              Body redacted under court order. The row is preserved; the audit chain records the
              redaction event.
            </p>
          )}
          {data.body_ciphertext_sha256 && (
            <details className="text-xs space-y-2">
              <summary className="cursor-pointer text-gray-700">Tamper-evident receipt</summary>
              <dl className="space-y-1 mt-2">
                <div className="flex flex-col">
                  <dt className="text-gray-500">body_ciphertext_sha256</dt>
                  <dd className="font-mono break-all">{data.body_ciphertext_sha256}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-gray-500">last_disposition_audit_event_id</dt>
                  <dd className="font-mono break-all">
                    {data.last_disposition_audit_event_id ?? '— (still NEW, no transitions yet)'}
                  </dd>
                </div>
              </dl>
              <label className="block mt-3">
                <span className="text-gray-700 mr-2">Verify locally:</span>
                <input
                  type="file"
                  aria-label="upload your encrypted-blob copy"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void verifyLocally(f);
                  }}
                />
              </label>
              {verify.state === 'busy' && <p className="text-gray-600">computing…</p>}
              {verify.state === 'match' && (
                <p role="status" className="text-green-700">
                  ✓ match — your local copy and the system have the same SHA-256.
                </p>
              )}
              {verify.state === 'mismatch' && (
                <p role="alert" className="text-red-700 break-all">
                  ✗ mismatch — {verify.detail}. Take this output to a journalist or to the council;
                  the system has changed the tip you submitted.
                </p>
              )}
              {verify.state === 'error' && (
                <p role="alert" className="text-red-700">
                  could not compute: {verify.detail}
                </p>
              )}
            </details>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </>
  );
}
