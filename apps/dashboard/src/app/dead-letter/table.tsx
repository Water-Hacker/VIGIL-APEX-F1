'use client';

import { useState } from 'react';

import type { DeadLetterRow } from '../../lib/dead-letter.server';

interface Labels {
  retryOne: string;
  retryBulk: string;
  resolve: string;
}

export function DeadLetterTable({
  rows,
  labels,
}: {
  rows: ReadonlyArray<DeadLetterRow>;
  labels: Labels;
}): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function act(action: 'retry' | 'resolve', ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const reason = action === 'resolve' ? prompt('Reason?') ?? 'manual' : undefined;
      const r = await fetch('/api/dead-letter/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids, action, ...(reason && { reason }) }),
      });
      if (!r.ok) throw new Error(`http ${r.status}`);
      // Server-rendered list — easiest to refresh by reload.
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() => act('retry', Array.from(selected))}
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:bg-gray-300"
        >
          {labels.retryBulk} ({selected.size})
        </button>
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() => act('resolve', Array.from(selected))}
          className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm disabled:bg-gray-300"
        >
          {labels.resolve} ({selected.size})
        </button>
      </div>

      <table className="w-full text-sm border rounded">
        <thead className="text-left text-gray-500 border-b">
          <tr>
            <th className="px-2 py-1" aria-label="select" />
            <th className="px-2 py-1">worker</th>
            <th className="px-2 py-1">source</th>
            <th className="px-2 py-1">reason</th>
            <th className="px-2 py-1 text-right">retries</th>
            <th className="px-2 py-1">last attempt</th>
            <th className="px-2 py-1" aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0 align-top">
              <td className="px-2 py-1">
                <input
                  type="checkbox"
                  aria-label={`select ${r.id}`}
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                />
              </td>
              <td className="px-2 py-1 font-mono text-xs">{r.worker}</td>
              <td className="px-2 py-1 font-mono text-xs">{r.source_id ?? '—'}</td>
              <td className="px-2 py-1 break-all">{r.reason}</td>
              <td className="px-2 py-1 tabular-nums text-right">{r.retry_count}</td>
              <td className="px-2 py-1 tabular-nums text-xs">{r.last_attempt}</td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act('retry', [r.id])}
                  className="text-blue-700 underline text-xs"
                >
                  {labels.retryOne}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
