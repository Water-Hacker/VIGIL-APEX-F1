'use client';

import { useState } from 'react';

interface Props {
  proposalId: string;
  awaitingApproval: boolean;
}

export function DecisionForm({ proposalId, awaitingApproval }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function decide(decision: 'promoted' | 'rejected'): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const reason =
        decision === 'rejected' ? prompt('Reason (logged):') ?? 'manual-reject' : undefined;
      const r = await fetch('/api/triage/adapter-repairs/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposal_id: proposalId, decision, reason }),
      });
      if (!r.ok) throw new Error(`http ${r.status}`);
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={busy || !awaitingApproval}
        onClick={() => decide('promoted')}
        className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm disabled:bg-gray-300"
      >
        Promote
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => decide('rejected')}
        className="px-3 py-1.5 rounded bg-red-600 text-white text-sm disabled:bg-gray-300"
      >
        Reject
      </button>
      {err && (
        <span role="alert" className="text-sm text-red-700 ml-2 self-center">
          {err}
        </span>
      )}
    </div>
  );
}
