'use client';

import { useState } from 'react';

interface Labels {
  uploadHash: string;
  match: string;
  mismatch: string;
}

/** Compute SHA-256 of a Blob in the browser via WebCrypto. */
async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function HashCheckWidget({
  expectedSha256,
  labels,
}: {
  expectedSha256: string;
  labels: Labels;
}): JSX.Element {
  const [result, setResult] = useState<'idle' | 'match' | 'mismatch'>('idle');
  const [actual, setActual] = useState<string | null>(null);

  return (
    <section aria-labelledby="hash-check" className="border rounded p-4 space-y-2">
      <h2 id="hash-check" className="text-xl font-semibold">
        {labels.uploadHash}
      </h2>
      <input
        type="file"
        aria-label="upload-file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const hex = await sha256Hex(f);
          setActual(hex);
          setResult(hex.toLowerCase() === expectedSha256.toLowerCase() ? 'match' : 'mismatch');
        }}
      />
      {actual && (
        <p className="text-xs font-mono break-all">{actual}</p>
      )}
      {result === 'match' && (
        <p role="status" className="text-sm text-emerald-700">
          ✓ {labels.match}
        </p>
      )}
      {result === 'mismatch' && (
        <p role="alert" className="text-sm text-red-700">
          ✗ {labels.mismatch}
        </p>
      )}
    </section>
  );
}
