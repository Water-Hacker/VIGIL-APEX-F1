'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { useState } from 'react';

type Choice = 'YES' | 'NO' | 'ABSTAIN' | 'RECUSE';

interface Labels {
  yes: string;
  no: string;
  abstain: string;
  recuse: string;
  touchYubikey: string;
  broadcasting: string;
  duplicate: string;
  success: string;
  submit: string;
  cancel: string;
}

interface Props {
  proposalId: string;
  labels: Labels;
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'webauthn' }
  | { kind: 'broadcasting' }
  | { kind: 'success'; tx: string }
  | { kind: 'error'; message: string };

/**
 * Council vote ceremony (Phase C5). The flow:
 *   1. Member picks a choice + optional recuse reason.
 *   2. Browser requests a WebAuthn assertion from the member's enrolled
 *      YubiKey (challenge from /api/council/vote/challenge — TODO C5b).
 *   3. The page invokes the local vigil-polygon-signer helper (W-10 fallback
 *      pulls a desktop helper download URL for non-Chrome environments).
 *   4. On tx-hash receipt, POST /api/council/vote with the assertion + tx.
 *
 * For this Phase 1 build, the on-chain broadcast is fronted by the host
 * helper; the assertion is collected here and shipped to the server. See
 * apps/dashboard/public/native-helper-download for the desktop bundle.
 */
export function VoteCeremony({ proposalId, labels }: Props): JSX.Element {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  async function submit(): Promise<void> {
    if (!choice) return;
    try {
      setStage({ kind: 'webauthn' });
      // 1. Get challenge
      const optsRes = await fetch(`/api/council/vote/challenge?p=${proposalId}`);
      if (!optsRes.ok) throw new Error('challenge-failed');
      const opts = await optsRes.json();

      // 2. WebAuthn assertion (YubiKey touch)
      const assertion = await startAuthentication(opts);

      // 3. Trigger Polygon broadcast via host helper
      setStage({ kind: 'broadcasting' });
      const txRes = await fetch('http://127.0.0.1:8765/sign-vote', {
        method: 'POST',
        body: JSON.stringify({ proposalId, choice }),
        headers: { 'content-type': 'application/json' },
      });
      if (!txRes.ok) throw new Error('signer-failed');
      const { tx, voter_address, voter_pillar } = await txRes.json();

      // 4. Persist on the server
      const r = await fetch('/api/council/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          proposal_id: proposalId,
          choice,
          webauthn_assertion: assertion,
          onchain_tx_hash: tx,
          voter_address,
          voter_pillar,
          ...(choice === 'RECUSE' && reason && { recuse_reason: reason }),
        }),
      });
      if (r.status === 409) {
        setStage({ kind: 'error', message: labels.duplicate });
        return;
      }
      if (!r.ok) throw new Error(`http ${r.status}`);
      setStage({ kind: 'success', tx });
    } catch (e) {
      setStage({ kind: 'error', message: e instanceof Error ? e.message : 'unknown' });
    }
  }

  return (
    <section aria-labelledby="vote-form" className="border rounded p-4 space-y-4">
      <h2 id="vote-form" className="sr-only">
        Vote
      </h2>

      <fieldset className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <legend className="sr-only">Choix</legend>
        {(
          [
            ['YES', labels.yes],
            ['NO', labels.no],
            ['ABSTAIN', labels.abstain],
            ['RECUSE', labels.recuse],
          ] as const
        ).map(([key, label]) => (
          <label
            key={key}
            className={`border rounded p-3 cursor-pointer text-center ${
              choice === key ? 'bg-blue-50 border-blue-500' : 'hover:bg-gray-50'
            }`}
          >
            <input
              type="radio"
              name="choice"
              value={key}
              className="sr-only"
              checked={choice === key}
              onChange={() => setChoice(key)}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {choice === 'RECUSE' && (
        <label className="block">
          <span className="text-sm">Reason (private)</span>
          <textarea
            className="mt-1 block w-full border rounded p-2"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}

      <button
        type="button"
        disabled={!choice || stage.kind === 'webauthn' || stage.kind === 'broadcasting'}
        onClick={submit}
        className="px-4 py-2 rounded bg-blue-600 text-white disabled:bg-gray-300"
      >
        {labels.submit}
      </button>

      {stage.kind === 'webauthn' && (
        <p role="status" className="text-sm text-amber-700">
          {labels.touchYubikey}
        </p>
      )}
      {stage.kind === 'broadcasting' && (
        <p role="status" className="text-sm text-blue-700">
          {labels.broadcasting}
        </p>
      )}
      {stage.kind === 'success' && (
        <p role="status" className="text-sm text-emerald-700">
          {labels.success.replace('{tx}', stage.tx)}
        </p>
      )}
      {stage.kind === 'error' && (
        <p role="alert" className="text-sm text-red-700">
          {stage.message}
        </p>
      )}
    </section>
  );
}
