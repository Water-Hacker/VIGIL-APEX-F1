import { Constants, Errors } from '@vigil/shared';

/**
 * Off-chain quorum logic mirror — used by the dashboard to predict outcomes
 * without an RPC call. The contract is the source of truth.
 *
 * SRD §23.3:
 *   - 3-of-5 YES → escalate
 *   - 3-of-5 NO  → dismiss
 *   - Neither reached within 14 days → expired (inconclusive)
 *   - 4-of-5 YES required for public release (higher bar; SRD §17.2/EXEC §17.2)
 */

export type Decision = 'escalate' | 'dismiss' | 'expired' | 'open';

export interface VoteTally {
  readonly yes: number;
  readonly no: number;
  readonly abstain: number;
  readonly recuse: number;
}

/**
 * Tier-45 audit closure — refuse to evaluate a structurally-invalid tally.
 *
 * Pre-fix, `decisionFor` happily ran on NaN/Infinity/negative/non-integer
 * vote counts and returned a misleading result (e.g., `yes: NaN` made the
 * `>= 3` check return false silently, falling through to a wrong 'open').
 * The off-chain mirror is the dashboard's prediction layer; if a malformed
 * projection (replay bug, indexer drift, read-side cache corruption) feeds
 * in here, we'd silently render the wrong outcome on the operator's
 * screen instead of surfacing the upstream defect.
 *
 * What we do NOT validate: the tally TOTAL against QUORUM_SIZE. The
 * existing precedence tests (quorum-edge-cases.test.ts) intentionally
 * exercise tied 3-YES/3-NO ballots that are impossible with the current
 * 5-member council but document precedence rules for a future 7- or
 * 9-member council. Pinning the per-field shape is a strict defence
 * win; pinning the total would over-couple to today's QUORUM_SIZE.
 */
function assertWellFormedTally(tally: VoteTally): void {
  const fields: Array<[keyof VoteTally, number]> = [
    ['yes', tally.yes],
    ['no', tally.no],
    ['abstain', tally.abstain],
    ['recuse', tally.recuse],
  ];
  for (const [name, value] of fields) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Errors.GovernanceError({
        code: 'GOVERNANCE_TALLY_MALFORMED',
        message: `tally field ${name} must be a non-negative integer; got ${value}`,
        severity: 'error',
        context: { field: name, value },
      });
    }
  }
}

export function decisionFor(tally: VoteTally, isExpired: boolean): Decision {
  assertWellFormedTally(tally);
  if (tally.yes >= Constants.QUORUM_REQUIRED_ESCALATE) return 'escalate';
  if (tally.no >= Constants.QUORUM_REQUIRED_ESCALATE) return 'dismiss';
  if (isExpired) return 'expired';
  return 'open';
}

export function publicReleaseDecision(tally: VoteTally): Decision {
  assertWellFormedTally(tally);
  if (tally.yes >= Constants.QUORUM_REQUIRED_PUBLIC_RELEASE) return 'escalate';
  if (tally.no >= Constants.QUORUM_REQUIRED_ESCALATE) return 'dismiss';
  return 'open';
}

export function totalNonRecuseVoters(tally: VoteTally): number {
  return tally.yes + tally.no + tally.abstain;
}

export function assertCannotDoubleVote(existingChoices: readonly string[]): void {
  if (existingChoices.length > 1) {
    throw new Errors.GovernanceError({
      code: 'GOVERNANCE_DOUBLE_VOTE',
      message: `double-vote rejected: voter cast ${existingChoices.length} votes`,
      severity: 'error',
    });
  }
}
