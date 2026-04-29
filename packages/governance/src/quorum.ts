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

export function decisionFor(tally: VoteTally, isExpired: boolean): Decision {
  if (tally.yes >= Constants.QUORUM_REQUIRED_ESCALATE) return 'escalate';
  if (tally.no >= Constants.QUORUM_REQUIRED_ESCALATE) return 'dismiss';
  if (isExpired) return 'expired';
  return 'open';
}

export function publicReleaseDecision(tally: VoteTally): Decision {
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
