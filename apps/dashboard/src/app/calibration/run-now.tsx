'use client';

import { useState } from 'react';

export function RunNowButton({ label }: { label: string }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await fetch('/api/calibration/run', { method: 'POST' });
          if (!r.ok) throw new Error(`http ${r.status}`);
          setDone(true);
        } finally {
          setBusy(false);
        }
      }}
      className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:bg-gray-300"
    >
      {done ? '✓' : label}
    </button>
  );
}
