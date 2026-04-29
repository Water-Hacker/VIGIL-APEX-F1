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
}

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

  async function lookup(target: string): Promise<void> {
    setBusy(true);
    setError(null);
    setData(null);
    try {
      const r = await fetch(`/api/tip/status?ref=${encodeURIComponent(target)}`);
      if (r.status === 404) {
        setError(labels.notFound);
        return;
      }
      if (!r.ok) throw new Error(`http ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown');
    } finally {
      setBusy(false);
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
        <div className="border rounded p-4 space-y-1">
          <div>
            <span className="text-xs uppercase text-gray-500 mr-2">{labels.dispositionLabel}</span>
            <span className="font-mono">{data.disposition}</span>
          </div>
          <div className="text-sm text-gray-600">
            {labels.receivedOnLabel.replace('{date}', data.received_on)}
          </div>
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
