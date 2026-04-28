'use client';

import { useEffect } from 'react';

/**
 * Top-level error boundary. Caught by Next at every route segment unless
 * a nested error.tsx is provided. Logs the error so Sentry / RUM (C16)
 * can correlate with the request trace_id.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    // Browser-side console; SDK in C16 picks this up automatically.
    console.error('[ui-error]', error);
  }, [error]);

  return (
    <main className="mx-auto max-w-md p-6 space-y-3" role="alert">
      <h1 className="text-xl font-semibold">Une erreur est survenue.</h1>
      <p className="text-sm text-gray-600">
        {error.digest ? <>Digest&nbsp;: <code>{error.digest}</code></> : null}
      </p>
      <button
        type="button"
        onClick={reset}
        className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm"
      >
        Réessayer / Retry
      </button>
    </main>
  );
}
